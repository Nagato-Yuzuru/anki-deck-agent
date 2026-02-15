terraform {
  required_version = ">= 1.11.0"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "5.17.0"
    }
  }
  backend "s3" {
    bucket                      = var.state_bucket_name
    key                         = "bootstrap/terraform.tfstate"
    region                      = "auto"
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    use_path_style              = true
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

resource "cloudflare_r2_bucket" "tofu_state" {
  account_id = var.cloudflare_account_id
  name       = var.state_bucket_name
}

output "state_bucket_name" {
  description = "R2 bucket name to use as backend in each environment"
  value       = cloudflare_r2_bucket.tofu_state.name
}

variable "state_bucket_name" {
  description = "R2 bucket name for storing Terraform remote state"
  type        = string
  default     = "tofu-state"
}

variable "cloudflare_api_token" {
  description = "Cloudflare API token"
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID"
  type        = string
}
