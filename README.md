# GitHub Action to upload to Apple's TestFlight service

[![License](https://img.shields.io/badge/license-MIT-green.svg?style=flat)](LICENSE)
[![PRs welcome!](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

## Getting Started (can be the same key as the [download provisioning profiles action](https://github.com/Apple-Actions/download-provisioning-profiles/blob/master/README.md#getting-started))

* Create an `App Store Connect API Key` ([these instructions](https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api) with the role `App Manager`)
* Download the certificate (must be done upon creation and will be called `ios_distribution.cer`)
* Copy the `.p8` ( `cat AuthKey_<key_id>.p8 | pbcopy` )
* Add it as a secret called `APPSTORE_API_PRIVATE_KEY` and add `Key ID` as a variable called `APPSTORE_API_KEY_ID`
* Add `Issuer ID` as a variable called `APPSTORE_ISSUER_ID` ([found here](https://appstoreconnect.apple.com/access/integrations/api))

## Usage:

```yaml
- name: 'Upload app to TestFlight'
  uses: apple-actions/upload-testflight-build@v4
  with: 
    app-path: 'path/to/application.ipa' 
    issuer-id: ${{ vars.APPSTORE_ISSUER_ID }}
    api-key-id: ${{ vars.APPSTORE_API_KEY_ID }}
    api-private-key: ${{ secrets.APPSTORE_API_PRIVATE_KEY }}
    release-notes: ${{ steps.generate_notes.outputs.whats_new }} # optional
    uses-non-exempt-encryption: 'false' # optional: "true" or "false" maps directly to App Store Connect usesNonExemptEncryption
    wait-for-processing: 'true' # optional: set to "false" to skip waiting (metadata updates will be skipped)
    backend: AppStoreAPI # optional: AppStoreAPI | transporter | altool (default: AppStoreAPI; case insensitive)
```

> [!IMPORTANT]
> `transporter` backend requires Transporter to be installed on the runner and the action now calls the installed binary directly (no `xcrun` shim).
> The GitHub hosted runners (Xcode 14+) do not have Transporter installed by default.
> You can install it in your workflow before this action runs:
>
> ```yaml
> - name: Install Transporter
>   run: |
>     url="https://itunesconnect.apple.com/WebObjects/iTunesConnect.woa/ra/resources/download/public/Transporter__OSX/bin/"
>     curl -fsSL "$url" -o "/tmp/itmstransporter.pkg"
>     sudo installer -pkg "/tmp/itmstransporter.pkg" -target /
>     /usr/local/itms/bin/iTMSTransporter -help
> ```
>
> Alternatively, use a self-hosted runner that already has Transporter installed at `/usr/local/itms/bin/iTMSTransporter`.


## Additional Arguments

See [action.yml](action.yml) for more details.

## Contributing

We welcome your interest in contributing to this project. Please read the [Contribution Guidelines](CONTRIBUTING.md) for more guidance.

## License

Any contributions made under this project will be governed by the [MIT License](LICENSE).
