# 🔨 NEED NEW MAINTAINER 🔨

This repository needs a new maintainer who can actively manage it. If you would like to become that maintainer then please contact me (@orj@mastodon.social).

# GitHub Action to upload to Apple's TestFlight service

## Usage:

```yaml
- name: 'Upload app to TestFlight'
  uses: apple-actions/upload-testflight-build@v2
  with: 
    app-path: 'path/to/application.ipa' 
    issuer-id: ${{ secrets.APPSTORE_ISSUER_ID }}
    api-key-id: ${{ secrets.APPSTORE_API_KEY_ID }}
    api-private-key: ${{ secrets.APPSTORE_API_PRIVATE_KEY }}
```

## Additional Arguments

See [action.yml](action.yml) for more details.
