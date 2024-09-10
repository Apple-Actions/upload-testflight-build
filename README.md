# GitHub Action to upload to Apple's TestFlight service

## Usage:

```yaml
- name: 'Upload app to TestFlight'
  uses: apple-actions/upload-testflight-build@v1
  with: 
    app-path: 'path/to/application.ipa' 
    issuer-id: ${{ secrets.APPSTORE_ISSUER_ID }}
    api-key-id: ${{ secrets.APPSTORE_API_KEY_ID }}
    api-private-key: ${{ secrets.APPSTORE_API_PRIVATE_KEY }}
```

please note: for  `api-private-key` parameter, just copy the content of Private Key's content and store it as value of APPSTORE_API_PRIVATE_KEY secret.
## Additional Arguments

See [action.yml](action.yml) for more details.
