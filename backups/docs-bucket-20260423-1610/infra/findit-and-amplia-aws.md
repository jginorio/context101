# FindIt and Amplia AWS Lambda ARNs

AWS Lambda function ARNs for the FindIt (`finditpr.com`) and Amplia MLS (`ampliamls.com`) API environments. Useful for debugging infrastructure issues.

All functions are in the `us-east-1` region under AWS account `722295155959`.

## Lambda ARNs by domain

| Domain | Environment | Lambda ARN |
| --- | --- | --- |
| `api.finditpr.com` | FindIt production | `arn:aws:lambda:us-east-1:722295155959:function:api-finditpr-production` |
| `api-staging.finditpr.com` | FindIt staging | `arn:aws:lambda:us-east-1:722295155959:function:api-finditpr-staging` |
| `api.ampliamls.com` | Amplia MLS production | `arn:aws:lambda:us-east-1:722295155959:function:amplia-mls-api-production` |
| `staging-api.ampliamls.com` | Amplia MLS staging | `arn:aws:lambda:us-east-1:722295155959:function:amplia-mls-api-staging` |
