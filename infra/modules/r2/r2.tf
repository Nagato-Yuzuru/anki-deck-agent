terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

variable "account_id" { type = string }
variable "bucket_name" { type = string }
variable "location" {
  type = string
}

resource "cloudflare_r2_bucket" "this" {
  account_id = var.account_id
  name       = var.bucket_name
  location   = var.location
}

output "id" { value = cloudflare_r2_bucket.this.id }
output "name" { value = cloudflare_r2_bucket.this.name }
