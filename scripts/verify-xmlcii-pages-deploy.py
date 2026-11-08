#!/usr/bin/env python3
"""Post-deployment GitHub Pages smoke: compare public assets to exact main SHA.

Success requires independent HTTP fetch of deployed bytes, not merely a GitHub
Actions deploy result. Failure does not roll back deployment; it marks deploy
verification FAILED and preserves the mismatch receipt.
"""
from __future__ import annotations
import hashlib,json,os,sys,time,urllib.parse,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
PAGE_URL=os.environ.get("PAGE_URL","").strip()
SHA=os.environ.get("GITHUB_SHA","").strip()
ART=ROOT/"artifacts"
ART.mkdir(parents=True,exist_ok=True)
OUT=ART/"phase6-pages-deployment-verification.json"
assert PAGE_URL.startswith("https://") and SHA and len(SHA)==40,(
    "PAGE_URL from actual Pages deployment and 40-character commit SHA are required")

ASSETS=[
  "index.html",
  "tabs/xml-cii-2019-standalone-tab.js",
  "tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-phase6-unified-review.js",
  "tabs/xml-cii-2019-standalone/ui-adapted/xml-cii-adapted-rigid-review-mode-a.js",
  "converters/xml-cii2019-core/phase6-mass-comparison.js",
]
expected={}
for relative in ASSETS:
    data=(ROOT/relative).read_bytes()
    expected[relative]={"sha256":hashlib.sha256(data).hexdigest(),
                        "bytes":len(data)}
results=[]
base=PAGE_URL.rstrip("/")+"/"
for attempt in range(1,13):
    results=[]
    for relative in ASSETS:
        url=urllib.parse.urljoin(base,relative)+"?verify_sha="+SHA
        row={"file":relative,"url":url}
        try:
            request=urllib.request.Request(url,headers={
                "Accept-Encoding":"identity","Cache-Control":"no-cache",
                "User-Agent":"phase6-deploy-parity/1.0"})
            with urllib.request.urlopen(request,timeout=30) as response:
                data=response.read()
                row["httpStatus"]=response.status
            row["deliveredSha256"]=hashlib.sha256(data).hexdigest()
            row["deliveredBytes"]=len(data)
            row["bytesEqual"]=data==(ROOT/relative).read_bytes()
        except Exception as error:
            row["bytesEqual"]=False
            row["error"]=str(error)
        results.append(row)
    receipt={
      "schema":"GLRD-PHASE6-PAGES-DEPLOYED-BYTES-V1",
      "repositoryCommit":SHA,
      "publicPageUrl":PAGE_URL,
      "verificationMethod":"INDEPENDENT_HTTP_FETCH_SHA256_EXACT_BYTES",
      "attempt":attempt,
      "expected":expected,
      "assets":results,
      "allAssetsByteEqual":all(r.get("bytesEqual") for r in results),
    }
    OUT.write_text(json.dumps(receipt,indent=2)+"\n")
    if receipt["allAssetsByteEqual"]:
        print("PHASE6_PAGES_DEPLOYED_BYTE_PARITY_PASS",json.dumps({
            "commit":SHA,"assets":len(results),"attempt":attempt,
            "url":PAGE_URL}))
        sys.exit(0)
    if attempt<12:time.sleep(10)
print("PHASE6_PAGES_DEPLOYED_BYTE_PARITY_FAIL",json.dumps({
    "commit":SHA,"url":PAGE_URL,
    "failed":[{"file":r["file"],"error":r.get("error"),"hash":r.get("deliveredSha256")}
              for r in results if not r.get("bytesEqual")]}),file=sys.stderr)
sys.exit(1)
