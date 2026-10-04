# Privacy Policy for NeoOmega

Last updated: October 4, 2026

NeoOmega ("we", "our", or "the extension") is an open-source browser extension designed to provide proxy management and smart rule switching for Chromium-based browsers.

We respect your privacy and are committed to protecting it. This Privacy Policy outlines our data handling practices.

## 1. Information We Do NOT Collect
- **Personal Information**: We do not collect names, email addresses, phone numbers, or any other personally identifiable information.
- **Browsing History**: We do not monitor, record, store, or transmit your browsing history, visited URLs, or web traffic.
- **Analytics / Tracking**: We do not use any third-party analytics (such as Google Analytics), telemetry, tracking pixels, or diagnostic beacons.
- **Authentication Credentials**: Any proxy authentication credentials (usernames/passwords) entered into the extension are stored strictly on your local device. We never transmit them to any external servers.

## 2. Information Handled Locally
- **Local Storage**: All extension settings, profiles, routing rules, and preferences are stored exclusively on your local machine using the Chrome extension storage API (`chrome.storage.local`).
- **Optional Chrome Sync**: If you explicitly enable Chrome sync, your settings may be synchronized across your own devices using Google's encrypted `chrome.storage.sync` infrastructure. We do not have access to this data.

## 3. Network Communications Initiated by the Extension
The extension only initiates network connections in direct response to user configuration:
- **Rule List Subscriptions**: When you configure a remote PAC script URL or an AutoProxy / GFWList subscription, the extension fetches the rule text directly from that URL to update your local rule set.
- **Network / IP Leak Testing**: When you manually trigger the IP leak test in the Network settings tab, the extension queries public IP echo services to display your current public IP, WebRTC status, and DNS resolver information on screen. No data is saved or shared.

## 4. Permissions Usage
- `proxy`: Configures proxy settings in Chrome as defined by your profiles.
- `storage`: Saves your profiles and preferences locally.
- `alarms`: Schedules periodic updates for your configured rule lists.
- `webRequest` & `webRequestAuthProvider`: Handles proxy authentication prompts and detects failed network connections to offer rule recommendations.
- `sidePanel`: Displays the extension control panel in Chrome's side panel.
- `scripting`: Runs local diagnostics in a sandboxed script to verify WebRTC IP leak protection.
- `privacy`: Configures WebRTC IP handling policies to prevent IP exposure.
- `<all_urls>`: Intercepts network authentication challenges across configured proxy destinations.

## 5. Contact & Open Source
NeoOmega is open source. You can inspect the source code to verify this policy at any time.

If you have questions about this Privacy Policy, please open an issue on the project repository.
