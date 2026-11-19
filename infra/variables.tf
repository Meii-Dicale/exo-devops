variable "ghcr_owner" {
  description = "Propriétaire des images sur ghcr.io (compte GitHub, en minuscules)."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9-]+$", var.ghcr_owner))
    error_message = "ghcr_owner : minuscules, chiffres et tirets uniquement (ghcr.io refuse les majuscules)."
  }
}

variable "image_tag" {
  description = "Tag des images taskflow-api et taskflow-front : SHA court du commit, ou latest."
  type        = string
  default     = "latest"

  validation {
    condition     = can(regex("^([0-9a-f]{7}|latest)$", var.image_tag))
    error_message = "image_tag : SHA court (7 caractères hexadécimaux) ou latest."
  }
}

variable "front_port" {
  description = "Port publié sur le poste pour le front (http://localhost:<port>)."
  type        = number
  default     = 8081

  validation {
    condition     = var.front_port >= 1024 && var.front_port <= 65535
    error_message = "front_port : entre 1024 et 65535 (pas de port privilégié)."
  }
}

variable "environment" {
  description = "Nom de l'environnement : préfixe des noms Docker et APP_ENV de l'API."
  type        = string
  default     = "staging"
}

variable "db_password" {
  description = "Mot de passe PostgreSQL. null : mot de passe aléatoire généré par random_password."
  type        = string
  default     = null
  sensitive   = true
}

variable "ghcr_username" {
  description = "Utilisateur pour tirer les images privées de ghcr.io (null : pas d'authentification)."
  type        = string
  default     = null
}

variable "ghcr_token" {
  description = "Jeton avec read:packages pour ghcr.io (dans le pipeline : GITHUB_TOKEN)."
  type        = string
  default     = null
  sensitive   = true
}
