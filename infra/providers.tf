# Sans configuration, le provider utilise DOCKER_HOST s'il est défini,
# sinon unix:///var/run/docker.sock.
provider "docker" {
  # Authentification à ghcr.io seulement si un jeton est fourni (paquets privés).
  # Le jeton configure le provider : il n'est pas écrit dans le state.
  dynamic "registry_auth" {
    for_each = var.ghcr_token == null ? [] : [1]
    content {
      address  = "ghcr.io"
      username = var.ghcr_username
      password = var.ghcr_token
    }
  }
}
