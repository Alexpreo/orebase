# OreBase infra — Terraform stub

Provisions the minimum AWS footprint for ingestion:

- A **versioned** S3 bucket for the document corpus (`aws_s3_bucket` + `aws_s3_bucket_versioning`), with public access fully blocked.
- A **scoped IAM user** for the worker fleet with least-privilege access: read/write on that one bucket + Textract detect/analyze.

This is a stub. **Do not run it without reviewing** — it creates billable AWS resources and a
long-lived IAM access key. No AWS credentials are wired in here.

## Usage

```bash
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars — bucket_name must be globally unique

terraform init
terraform plan
terraform apply
```

After apply, read the outputs into the workers `.env`:

```bash
terraform output -raw bucket_name              # -> S3_BUCKET
terraform output -raw aws_region               # -> AWS_REGION
terraform output -raw worker_access_key_id      # -> AWS_ACCESS_KEY_ID
terraform output -raw worker_secret_access_key  # -> AWS_SECRET_ACCESS_KEY  (sensitive)
```

## Notes

- Textract actions do not support resource-level ARNs, so that statement uses `"*"`; every
  other permission is scoped to the single corpus bucket.
- State contains the IAM secret key. Use a remote backend (e.g. S3 + DynamoDB lock) with
  encryption before using this beyond a throwaway account; do not commit `terraform.tfstate`.
- For production, prefer an EC2 instance role over a static IAM user access key.
- CloudWatch alarms on `OreBase/DocumentsLast24h` (per source) page when a poller goes silent. Set `alarm_email` in tfvars to subscribe. `enable_sedar_alarm` defaults to false until the first SEDAR document.
