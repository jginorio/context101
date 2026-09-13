/** Keep cdk.out out of Docker / fromAsset contexts so staging cannot recurse. */
export const CDK_OUT_EXCLUDE = ["cdk.out", "**/cdk.out"];
