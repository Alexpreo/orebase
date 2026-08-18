variable "aws_region" {
  description = "AWS region for the bucket and IAM resources."
  type        = string
  default     = "us-east-1"
}

variable "bucket_name" {
  description = "Globally-unique S3 bucket name for the document corpus."
  type        = string
}

variable "iam_user_name" {
  description = "Name of the scoped IAM user used by the worker fleet."
  type        = string
  default     = "orebase-workers"
}
