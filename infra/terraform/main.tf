terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# --- Document corpus bucket (versioning ON: the corpus is the crown-jewel asset) ---
resource "aws_s3_bucket" "documents" {
  bucket = var.bucket_name
}

resource "aws_s3_bucket_versioning" "documents" {
  bucket = aws_s3_bucket.documents.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "documents" {
  bucket                  = aws_s3_bucket.documents.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# --- Scoped IAM user for the worker fleet (least privilege) ---
resource "aws_iam_user" "workers" {
  name = var.iam_user_name
}

resource "aws_iam_access_key" "workers" {
  user = aws_iam_user.workers.name
}

data "aws_iam_policy_document" "workers" {
  # S3 read/write limited to this one bucket.
  statement {
    sid     = "S3BucketList"
    actions = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [aws_s3_bucket.documents.arn]
  }
  statement {
    sid = "S3ObjectRW"
    actions = [
      "s3:GetObject",
      "s3:GetObjectVersion",
      "s3:PutObject",
    ]
    resources = ["${aws_s3_bucket.documents.arn}/*"]
  }

  # Textract for OCR of scanned pages / hard tables.
  statement {
    sid = "TextractDetectAnalyze"
    actions = [
      "textract:DetectDocumentText",
      "textract:AnalyzeDocument",
      "textract:StartDocumentTextDetection",
      "textract:GetDocumentTextDetection",
      "textract:StartDocumentAnalysis",
      "textract:GetDocumentAnalysis",
    ]
    resources = ["*"] # Textract actions do not support resource-level scoping.
  }

  statement {
    sid     = "CloudWatchIngestMetrics"
    actions = ["cloudwatch:PutMetricData"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "cloudwatch:namespace"
      values   = ["OreBase"]
    }
  }

  statement {
    sid = "SSMReadOreBase"
    actions = [
      "ssm:GetParameter",
      "ssm:GetParameters",
      "ssm:GetParametersByPath",
    ]
    resources = [
      "arn:aws:ssm:${var.aws_region}:*:parameter/orebase",
      "arn:aws:ssm:${var.aws_region}:*:parameter/orebase/*",
    ]
  }

  statement {
    sid       = "SNSChallengeAndAlarms"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.ingest_alarms.arn]
  }
}

resource "aws_iam_user_policy" "workers" {
  name   = "${var.iam_user_name}-policy"
  user   = aws_iam_user.workers.name
  policy = data.aws_iam_policy_document.workers.json
}

resource "aws_sns_topic" "ingest_alarms" {
  name = "orebase-ingest-alarms"
}

resource "aws_sns_topic_subscription" "ingest_email" {
  count     = var.alarm_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.ingest_alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

resource "aws_cloudwatch_metric_alarm" "source_silent" {
  for_each = toset(var.enable_sedar_alarm ? ["edgar", "sedar", "newswire"] : ["edgar", "newswire"])

  alarm_name          = "orebase-${each.key}-silent-24h"
  alarm_description   = "No new raw.documents from ${each.key} in 24h. Bots fail silently; this is the silent-death page."
  namespace           = "OreBase"
  metric_name         = "DocumentsLast24h"
  dimensions          = { Source = each.key }
  statistic           = "Maximum"
  period              = 3600
  evaluation_periods  = 24
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.ingest_alarms.arn]
}
