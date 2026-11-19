output "url" {
  description = "URL du front de l'environnement."
  value       = "http://localhost:${var.front_port}"
}

output "health_url" {
  description = "URL du /health (passe par le Nginx du front, comme en production)."
  value       = "http://localhost:${var.front_port}/health"
}

output "image_tag" {
  description = "Tag des images déployées."
  value       = var.image_tag
}

output "containers" {
  description = "Noms des conteneurs."
  value       = [docker_container.db.name, docker_container.api.name, docker_container.front.name]
}

output "network" {
  description = "Réseau Docker de l'environnement."
  value       = docker_network.this.name
}
