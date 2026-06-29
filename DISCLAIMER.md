# Disclaimer

Veris is a software tool offered under the [MIT](LICENSE) license,
**without warranty of any kind**.

## About the account provider

The gateway includes an optional component, the **account provider**, which
automates the chat web interface of providers (OpenAI, Anthropic, Google) to use
a **subscription account** (Plus/Pro-style) as if it were an API.

You must understand the following before enabling it:

1. **It violates the Terms of Service** of OpenAI, Anthropic and Google. They
   prohibit automated access to their chat interfaces with subscription
   accounts.
2. **It may lead to permanent suspension or ban** of your account on those
   services.
3. It is **disabled by default** (`ACCOUNT_PROVIDER_ENABLED=false`). The
   recommended use of the project is **BYOK** (your own official API key), which
   is clean and within the ToS.
4. If you choose to enable it, you do so **entirely and exclusively at your own
   risk**. You are solely responsible for how you use this tool and for any
   resulting consequences.

## Local-first and privacy

The project is **local-first**: it runs entirely on your machine. API keys,
credentials and browser sessions stay on your disk (encrypted with AES-256-GCM
where applicable). **There is no central server**; the author never sees,
receives or stores your data.

## Limitation of liability

The software is provided "as is", without express or implied warranties. In no
event shall the authors or copyright holders be liable for any claim, damages or
other liability arising from the use of the software, including any violation of
third-party Terms of Service committed by the user. See the full text in
[`LICENSE`](LICENSE).
