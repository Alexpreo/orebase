output "bucket_name" {
  description = "Document corpus bucket name (set as S3_BUCKET in the workers env)."
  value       = aws_s3_bucket.documents.bucket
}

output "aws_region" {
  description = "Region of the created resources."
  value       = var.aws_region
}

output "worker_access_key_id" {
  description = "Access key id for the scoped worker IAM user."
  value       = aws_iam_access_key.workers.id
}

output "worker_secret_access_key" {
  description = "Secret access key for the scoped worker IAM user (sensitive)."
  value       = aws_iam_access_key.workers.secret
  sensitive   = true
}

output "ingest_alarm_topic_arn" {
  description = "SNS topic for ingestion silent-death alarms."
  value       = aws_sns_topic.ingest_alarms.arn
}
