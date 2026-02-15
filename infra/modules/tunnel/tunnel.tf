terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

variable "account_id" { type = string }
variable "tunnel_name" { type = string }

resource "random_password" "tunnel_secret" {
  length = 64
}

resource "cloudflare_zero_trust_tunnel_cloudflared" "this" {
  account_id = var.account_id
  name       = var.tunnel_name
  secret     = base64sha256(random_password.tunnel_secret.result)
}

output "id" { value = cloudflare_zero_trust_tunnel_cloudflared.this.id }
output "cname" { value = cloudflare_zero_trust_tunnel_cloudflared.this.cname }
output "tunnel_token" {
  value     = cloudflare_zero_trust_tunnel_cloudflared.this.tunnel_token
  sensitive = true
}
