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
    retry-attempts-on-timeout: 2
```

## Additional Arguments

See [action.yml](action.yml) for more details.
