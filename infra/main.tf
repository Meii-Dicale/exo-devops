# ============================================================================
# Environnement TaskFlow (staging) : traduction de compose.staging.yaml.
# Mêmes noms Docker qu'à l'étape 2 (réseau taskflow-staging, volume
# taskflow-staging-pgdata, conteneurs taskflow-staging-db|api|front) pour
# reprendre l'environnement existant sans perdre les données.
# ============================================================================

locals {
  prefix = "taskflow-${var.environment}"

  # Le mot de passe fourni (celui qui a initialisé le volume) ou, à défaut, l'aléatoire.
  db_password  = var.db_password != null ? var.db_password : random_password.db.result
  database_url = "postgres://taskflow:${local.db_password}@db:5432/taskflow"
}

# Sans caractères spéciaux : le mot de passe finit dans une URL (DATABASE_URL).
resource "random_password" "db" {
  length  = 32
  special = false
}

# ---------- Réseau et volume -------------------------------------------------

resource "docker_network" "this" {
  name = local.prefix
}

resource "docker_volume" "pgdata" {
  name = "${local.prefix}-pgdata"

  # Le volume a été créé par Compose, qui y a posé ses labels com.docker.compose.*.
  # Pour Docker, les labels d'un volume ne se modifient pas : sans cette ligne, le
  # plan détruit et recrée le volume (labels # forces replacement), donc la base.
  lifecycle {
    ignore_changes = [labels]
  }
}

# ---------- Images ------------------------------------------------------------
# keep_locally : un destroy ne supprime pas l'image du poste (elle sert à la prod
# et aux rollbacks).

resource "docker_image" "postgres" {
  name         = "docker.io/library/postgres:16-alpine"
  keep_locally = true
}

resource "docker_image" "api" {
  name         = "ghcr.io/${var.ghcr_owner}/taskflow-api:${var.image_tag}"
  keep_locally = true
}

resource "docker_image" "front" {
  name         = "ghcr.io/${var.ghcr_owner}/taskflow-front:${var.image_tag}"
  keep_locally = true
}

# ---------- Conteneurs -------------------------------------------------------

resource "docker_container" "db" {
  name    = "${local.prefix}-db"
  image   = docker_image.postgres.image_id
  restart = "unless-stopped"

  env = [
    "POSTGRES_USER=taskflow",
    "POSTGRES_PASSWORD=${local.db_password}",
    "POSTGRES_DB=taskflow",
  ]

  volumes {
    volume_name    = docker_volume.pgdata.name
    container_path = "/var/lib/postgresql/data"
  }

  networks_advanced {
    name    = docker_network.this.name
    aliases = ["db"]
  }

  healthcheck {
    test     = ["CMD-SHELL", "pg_isready -U taskflow -d taskflow"]
    interval = "10s"
    timeout  = "3s"
    retries  = 10
  }

  # Équivalent de depends_on: condition: service_healthy : l'apply attend que la
  # base soit "healthy" avant de passer à l'API.
  wait         = true
  wait_timeout = 120
}

resource "docker_container" "api" {
  name    = "${local.prefix}-api"
  image   = docker_image.api.image_id
  restart = "unless-stopped"

  env = [
    "DATABASE_URL=${local.database_url}",
    "APP_ENV=${var.environment}",
  ]

  # Alias "api" : c'est le nom que front/nginx.conf utilise (http://api:3000),
  # pas le nom du conteneur.
  networks_advanced {
    name    = docker_network.this.name
    aliases = ["api"]
  }

  healthcheck {
    test         = ["CMD-SHELL", "wget -q -O /dev/null http://127.0.0.1:3000/health || exit 1"]
    interval     = "10s"
    timeout      = "3s"
    retries      = 3
    start_period = "10s"
  }

  wait         = true
  wait_timeout = 120

  depends_on = [docker_container.db]
}

resource "docker_container" "front" {
  name    = "${local.prefix}-front"
  image   = docker_image.front.image_id
  restart = "unless-stopped"

  # Seul conteneur qui publie un port sur le poste.
  ports {
    internal = 80
    external = var.front_port
  }

  networks_advanced {
    name = docker_network.this.name
  }

  healthcheck {
    test     = ["CMD-SHELL", "wget -q -O /dev/null http://127.0.0.1/ || exit 1"]
    interval = "10s"
    timeout  = "3s"
    retries  = 3
    # Comme le HEALTHCHECK de front/Dockerfile. Sans cette ligne, Docker reprend
    # 5s depuis l'image et chaque plan propose de le remettre à 0s.
    start_period = "5s"
  }

  depends_on = [docker_container.api]
}
