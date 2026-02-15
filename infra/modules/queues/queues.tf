terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

variable "account_id" { type = string }
variable "queue_name" { type = string }

resource "cloudflare_queue" "this" {
  account_id = var.account_id
  queue_name = var.queue_name
}

output "id" { value = cloudflare_queue.this.queue_id }
output "name" { value = cloudflare_queue.this.queue_name }
