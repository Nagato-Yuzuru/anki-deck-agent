terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

resource "cloudflare_d1_database" "this" {
  account_id = var.account_id
  name       = var.database_name
}

output "id" {
  description = "The ID of the D1 Database"
  value       = cloudflare_d1_database.this.id
}

output "name" {
  description = "The Name of the D1 Database"
  value       = cloudflare_d1_database.this.name
}
