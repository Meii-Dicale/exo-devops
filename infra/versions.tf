# Versions d'OpenTofu et des providers.
# Le lock file (.terraform.lock.hcl, versionné) fige la version exacte et les
# empreintes des providers pour toutes les plateformes (poste, runner).
terraform {
  required_version = ">= 1.6"

  required_providers {
    docker = {
      source  = "kreuzwerker/docker"
      version = "~> 3.6"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Backend local volontairement vide : le chemin du state est donné à l'init,
  #   tofu init -backend-config="path=$STAGING_DIR/terraform.tfstate"
  # Le state contient le mot de passe de la base : il vit HORS du dépôt.
  backend "local" {}
}
