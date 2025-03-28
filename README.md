# GitHub Action to upload to Apple's TestFlight service

[![License](https://img.shields.io/badge/license-MIT-green.svg?style=flat)](LICENSE)
[![PRs welcome!](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

## Getting Started (can be the same key as the [download provisioning profiles action](https://github.com/Apple-Actions/download-provisioning-profiles/blob/master/README.md#getting-started))

* Create an `App Store Connect API Key` ([these instructions](https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api) with the role `App Manager`)
* Download the certificate (must be done upon creation and will be called `ios_distribution.cer`)
* Copy the `.p8` in base64 format ( `base64 -i AuthKey_<key_id>.p8 | pbcopy` )
* Add it as a secret called `APPSTORE_API_PRIVATE_KEY` and add `Key ID` as a variable called `APPSTORE_API_KEY_ID`
* Add `Issuer ID` as a variable called `APPSTORE_ISSUER_ID` ([found here](https://appstoreconnect.apple.com/access/integrations/api))

## Usage:

```yaml
- name: 'Upload app to TestFlight'
  uses: apple-actions/upload-testflight-build@v3
  with: 
    app-path: 'path/to/application.ipa' 
    issuer-id: ${{ vars.APPSTORE_ISSUER_ID }}
    api-key-id: ${{ vars.APPSTORE_API_KEY_ID }}
    api-private-key: ${{ secrets.APPSTORE_API_PRIVATE_KEY }}
```

## Additional Arguments

See [action.yml](action.yml) for more details.

## Contributing

We welcome your interest in contributing to this project. Please read the [Contribution Guidelines](CONTRIBUTING.md) for more guidance.

## License

Any contributions made under this project will be governed by the [MIT License](LICENSE).
