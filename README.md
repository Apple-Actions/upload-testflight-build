# GitHub Action to upload to Apple's TestFlight service

[![License](https://img.shields.io/badge/license-MIT-green.svg?style=flat)](LICENSE)
[![PRs welcome!](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

## Getting Started

Use the same App Store Connect API key as [`download-provisioning-profiles`](https://github.com/Apple-Actions/download-provisioning-profiles).

### Canonical GitHub ENVs

| Kind | Name | Purpose |
| --- | --- | --- |
| Variable | `APPSTORE_ISSUER_ID` | App Store Connect issuer ID |
| Variable | `APPSTORE_API_KEY_ID` | App Store Connect API key ID |
| Secret | `APPSTORE_API_PRIVATE_KEY` | Contents of `AuthKey_*.p8` |

1. Create an [App Store Connect API key](https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api) with the role `App Manager`
2. Download `AuthKey_<key_id>.p8` when the key is created (shown once)
3. Set the variable/secret names above (or run [`scripts/setup.sh`](https://github.com/Apple-Actions/download-provisioning-profiles#one-shot-setup) / `configure-github.sh`)

Issuer ID: [App Store Connect → Users and Access → Integrations → App Store Connect API](https://appstoreconnect.apple.com/access/integrations/api)

## Usage

```yaml
- name: Upload app to TestFlight
  uses: apple-actions/upload-testflight-build@v5
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

> [!NOTE]
> The default `appstore-api` backend only supports `.ipa` uploads. For macOS (`.pkg`) builds, set `backend: altool` or `backend: transporter`.

## Upgrading from v3 or earlier v4

* The default upload backend is now `appstore-api` (uses the App Store Connect API directly and works on Linux and macOS runners). If you depended on the previous behavior, set `backend: altool` or `backend: transporter`.
* The `transporter-response` output has been removed. Use the `upload-backend` output if you need to know which backend handled the upload.

## Additional Arguments

See [action.yml](action.yml) for more details.

## Contributing

We welcome your interest in contributing to this project. Please read the [Contribution Guidelines](CONTRIBUTING.md) for more guidance.

## License

Any contributions made under this project will be governed by the [MIT License](LICENSE).
