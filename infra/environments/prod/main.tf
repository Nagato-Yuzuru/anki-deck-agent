terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.0"
    }
  }
  backend "s3" {
    key                         = "prod/terraform.tfstate"
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

variable "cloudflare_api_token" {
  description = "Cloudflare API token"
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  type = string
}

variable "r2_location" {
  type = string
}


module "d1" {
  source        = "../../modules/d1"
  account_id    = var.cloudflare_account_id
  database_name = "prod-db-v1"
}

module "r2" {
  source      = "../../modules/r2"
  account_id  = var.cloudflare_account_id
  bucket_name = "prod-assets-bucket"
  location    = var.r2_location
}

module "queues" {
  source     = "../../modules/queues"
  account_id = var.cloudflare_account_id
  queue_name = "prod-event-queue"
}

resource "local_file" "denoflare_env" {
  filename = "${path.module}/../../../.env.infra"
  content  = <<-EOT

    CLOUDFLARE_ACCOUNT_ID=${var.cloudflare_account_id}

    # D1 Bindings
    D1_DATABASE_NAME=${module.d1.name}
    D1_DATABASE_ID=${module.d1.id}

    # R2 Bindings
    R2_BUCKET_NAME=${module.r2.name}

    # Queue Bindings
    QUEUE_NAME=${module.queues.name}
  EOT
}

resource "local_file" "wrangler_toml" {
  filename = "${path.module}/../../../wrangler.toml"
  content  = <<-EOT
    name = "my-worker"
    main = "dist/worker.js"
    compatibility_date = "2026-02-22"

    [[d1_databases]]
    binding = "DB"
    database_name = "${module.d1.name}"
    database_id = "${module.d1.id}"

    [[r2_buckets]]
    binding = "BUCKET"
    bucket_name = "${module.r2.name}"

    [[queues.producers]]
    binding = "QUEUE"
    queue = "${module.queues.name}"
  EOT
}
