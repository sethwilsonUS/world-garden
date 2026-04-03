# Apple Auth for Clerk

## What This Guide Is For

This guide is for adding **Sign in with Apple** to **Curio Garden's web sign-in flow through Clerk**.

This guide is **not** the native iPhone/TestFlight setup. The native app uses a separate Apple sign-in path. There is a short note about that near the end so the two flows do not get mixed together.

Expected result:

1. Apple appears in Curio Garden's existing Clerk sign-in UI.
2. A successful Apple sign-in still creates a normal Clerk session.
3. The Clerk session still reaches Convex, so dashboard, library, and playlist features keep working.

## Before You Start

Make sure all of these are already working:

1. You have a working Clerk application.
2. You have a working Apple Developer account.
3. Your local or production environment already has:
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
   - `CLERK_SECRET_KEY`
   - `CLERK_JWT_ISSUER_DOMAIN`
4. Curio Garden is already using Clerk's standard hosted auth flow through:
   - `ClerkProvider` in [app/layout.tsx](/Users/sethwilson/dev/world-garden/app/layout.tsx)
   - `SignInButton` in [components/AuthNavControls.tsx](/Users/sethwilson/dev/world-garden/components/AuthNavControls.tsx)
5. Clerk is already bridged into Convex through [lib/convex-data-provider.tsx](/Users/sethwilson/dev/world-garden/lib/convex-data-provider.tsx)

No Convex auth schema or JWT template change is expected just for adding Apple as another Clerk provider.

Important:

1. Do **development first**, not production first.
2. Clerk's current docs say development instances can use **shared Apple OAuth credentials and shared redirect URIs**. That is the easiest smoke test.
3. Apple custom credentials are mainly required for **production Clerk instances**.
4. If you try to configure custom Apple web credentials for plain `localhost`, you are likely to have a bad time. Apple web auth expects real HTTPS domains and exact callback settings. Let Clerk's shared development setup do the early heavy lifting.

## Values You Need to Collect

Use this table as your checklist.

| Value | Where to find it | What to copy |
| --- | --- | --- |
| Apple Team ID | `developer.apple.com/account` | Copy the short all-caps Team ID. In many Apple screens this also appears as the **App ID Prefix**. |
| Apple Services ID | Apple Developer → `Certificates, Identifiers & Profiles` → `Identifiers` → `Services IDs` | Copy the **Identifier** value for the Services ID. |
| Apple Key ID | Apple Developer → `Certificates, Identifiers & Profiles` → `Keys` | Copy the **Key ID** shown for the Sign in with Apple key. |
| Apple private key (`.p8`) | Apple Developer → created when you register the key | Download the `.p8` file immediately. Apple only lets you download it once. |
| Clerk Return URL | Clerk Dashboard → Apple connection modal | Copy the exact **Return URL** Clerk shows. Paste it into Apple's Services ID web configuration exactly as shown. |
| Clerk Email Source for Apple Private Email Relay | Clerk Dashboard → Apple connection modal | Copy the exact email value Clerk shows, such as a `bounces+...` address. |
| Clerk Frontend API URL / domain | Clerk Dashboard → API keys area, or your existing `CLERK_JWT_ISSUER_DOMAIN` value | Copy the full Frontend API URL first. For Apple's `Domains and Subdomains` field, use the same value **without** `https://`. |

## Safe Handling for the `.p8` File

Do this before you click any download button in Apple Developer:

1. Pick a temporary folder that is **outside this repo**.
2. A good example path is `~/Documents/secure-temp/apple-auth/`.
3. Create that folder before starting if it does not already exist.
4. Download the `.p8` file there.
5. Do **not** move it into `/Users/sethwilson/dev/world-garden`.
6. Do **not** commit it to git.
7. When Clerk is configured and tested, either delete the file or move it into your normal secure credential storage.

What you should see:

1. A file whose name usually starts with `AuthKey_` and ends with `.p8`
2. A Key ID on the same Apple screen

## Clerk Dev Setup First

Keep two browser tabs open:

1. One tab for the Clerk Dashboard
2. One tab for Apple Developer

### Open the Apple connection in Clerk

1. Open the Clerk Dashboard for your **development instance**.
2. In the left navigation, open `User & Authentication`.
3. Open `SSO connections`.
   - Clerk's docs call this page `SSO connections`.
   - Older wording may look more like `Social connections`.
4. Select `Add connection`.
5. Select `For all users`.
6. In the provider list, choose `Apple`.

What you should see:

1. A setup modal or page for Apple
2. In development, Clerk may say it uses shared Apple credentials and shared redirect URIs

### If Clerk offers shared development credentials

1. Use the shared development option first.
2. Save the Apple connection.
3. Go to the verification section later in this guide and test the sign-in flow in Curio Garden.

If shared development credentials work, that confirms the app side is already fine.

### If you want to prepare production credentials now

1. Stay on the Apple connection screen in the **development** instance first.
2. If the screen shows a `Use custom credentials` toggle, do not rush past it.
3. Turn on `Enable for sign-up and sign-in`.
4. Turn on `Use custom credentials` only when you are ready to collect the Apple values.
5. Copy these values from Clerk and save them in plain text somewhere safe:
   - `Return URL`
   - `Email Source for Apple Private Email Relay`
6. Keep this Clerk page open while you switch to Apple Developer.

What you should see:

1. A Return URL field or display
2. An Email Source value that looks like a bounce address

Copy this exact value:

1. The `Return URL` must be copied character-for-character.
2. The `Email Source` must be copied character-for-character.

## Apple Developer Portal Setup

Apple's exact labels matter here. Move slowly and copy values exactly.

### Find Your Team ID

1. Open `https://developer.apple.com/account`.
2. Sign in with the Apple Developer account that owns the Apple resources you will use.
3. Find the membership or account details area.
4. Look for your **Team ID**.

What you should see:

1. A short all-caps identifier
2. In some Apple screens, the same value appears as the **App ID Prefix**

Copy this exact value:

1. The Team ID only
2. Do not copy the team name around it

### Create or Confirm the App ID

Use this section even if you already think you have the App ID. It is worth confirming the capability.

1. In Apple Developer, open `Certificates, Identifiers & Profiles`.
2. In the sidebar, choose `Identifiers`.
3. In the filter or type chooser near the top-right, make sure you are looking at `App IDs`.
4. If you already have the App ID you want to use, open it.
5. If you do not already have one:
   - Select the add button `+`
   - Choose `App IDs`
   - Select `Continue`
   - Choose `App`
   - Select `Continue`
   - Enter a description
   - Enter a Bundle ID
6. In the capabilities list, make sure `Sign In with Apple` is enabled.
7. Continue through Apple's confirmation screen.
8. Save or register the App ID.

What you should see:

1. An App ID detail page
2. `Sign In with Apple` enabled in capabilities
3. An `App ID Prefix` near the top or in the details

Copy this exact value:

1. The `App ID Prefix` if you still need to record your Team ID

### Create the Services ID

This is the Apple value Clerk expects as the **Apple Services ID** for the web flow.

1. Stay in `Certificates, Identifiers & Profiles`.
2. Open `Identifiers`.
3. Change the identifier type filter to `Services IDs`.
4. Select the add button `+`.
5. Choose `Services IDs`.
6. Select `Continue`.
7. Enter a description such as `Curio Garden Clerk Web Login`.
8. Enter a stable reverse-domain identifier such as `org.curiogarden.clerk.web.apple`.
9. Select `Continue`.
10. Review the details.
11. Select `Register`.
12. Open the newly created Services ID from the list.
13. Make sure `Sign In with Apple` is enabled.
14. Select `Configure`.
15. Under `Primary App ID`, choose the App ID you created or confirmed earlier.
16. Under `Domains and Subdomains`, enter the Clerk frontend domain **without** `https://`.
    - Example: if your Frontend API URL is `https://clerk.example.com`, enter `clerk.example.com`
17. Under `Return URLs`, paste the exact Clerk `Return URL`.
18. Select `Next`.
19. On the confirmation screen, select `Done`.
20. Back on the Services ID page, select `Continue`.
21. Select `Save`.

What you should see:

1. A Services ID detail screen
2. A `Configure` flow for Sign In with Apple
3. Fields for:
   - `Primary App ID`
   - `Domains and Subdomains`
   - `Return URLs`

Copy this exact value:

1. The Services ID `Identifier`

Important:

1. This is the easiest place to make a typo.
2. Do not add `https://` in `Domains and Subdomains`.
3. Do not guess the Return URL.
4. Paste the exact Clerk value.

### Create the Sign in with Apple Key

This creates the **Apple Key ID** and the `.p8` private key Clerk needs.

1. In Apple Developer, stay inside `Certificates, Identifiers & Profiles`.
2. In the sidebar, choose `Keys`.
3. Select the add button `+`.
4. Enter a name such as `Curio Garden Clerk Apple Login`.
5. Enable `Sign In with Apple`.
6. Select `Configure`.
7. Under `Primary App ID`, choose the App ID from earlier.
8. Select `Save`.
9. Continue through Apple's confirmation screen.
10. Select `Register`.
11. On the download screen:
    - copy the `Key ID`
    - download the `.p8` file immediately
12. Select `Done`.

What you should see:

1. A `Key ID`
2. A one-time download button for the private key

Copy this exact value:

1. The `Key ID`
2. The full contents of the `.p8` file later, including:
   - `-----BEGIN PRIVATE KEY-----`
   - `-----END PRIVATE KEY-----`

Important:

1. Apple will not let you download the same `.p8` again later.
2. If you lose it, the usual recovery path is to create a new key and update Clerk.

### Set Up Private Email Relay

This step matters if Apple users choose the email privacy option.

1. In Apple Developer, stay in `Certificates, Identifiers & Profiles`.
2. In the sidebar, choose `Services`.
3. Find `Sign in with Apple for Email Communication`.
4. Select `Configure`.
5. In the `Email Sources` section, select the add button `+`.
6. Paste the exact `Email Source for Apple Private Email Relay` value you copied from Clerk.
7. Select `Next`.
8. Review the value carefully.
9. Select `Register`.
10. Select `Done`.

What you should see:

1. The email source listed in Apple's table
2. A verified or checking state

Important:

1. Apple's docs say the source must pass SPF checks.
2. If it is not verified immediately, wait a bit before assuming the setup failed.

## Paste Everything Back Into Clerk

Go back to the Clerk Apple connection screen you left open earlier.

1. Open the Clerk Dashboard for the **development instance** if you closed it.
2. Go to `User & Authentication`.
3. Open `SSO connections`.
4. Open the Apple connection screen.
5. Turn on:
   - `Enable for sign-up and sign-in`
   - `Use custom credentials`
6. Paste:
   - Apple Team ID
   - Apple Services ID
   - Apple Key ID
   - Apple private key contents from the `.p8` file
7. Save the connection.

What you should see:

1. Apple listed as an enabled connection
2. The connection attached to the development Clerk instance

Copy this exact value:

1. When you paste the private key, include the full block with the begin and end lines

## Verify It in Curio Garden

Use the app itself, not just the dashboards.

1. Run Curio Garden locally or open the deployed site tied to the Clerk instance you just configured.
2. Use the normal sign-in entrypoint in the site header.
3. Open the Clerk sign-in UI.
4. Confirm that Apple appears as a sign-in option.
5. Complete an Apple sign-in.

Then verify all of these:

1. You return to Curio Garden without a sign-in error.
2. The `UserButton` menu appears in the header.
3. The dashboard loads.
4. Signed-in Convex-backed features still work, such as:
   - synced library
   - dashboard
   - personal playlist

No UI code changes are expected here because the app already uses Clerk's standard hosted flow.

Optional extra check:

1. In the Clerk Dashboard, open `Account Portal`.
2. Visit the sign-in page Clerk provides.
3. Confirm Apple appears there too.

## Repeat for Production

After development works, repeat the setup for the production Clerk instance.

1. Open the **production** Clerk instance, not the development instance.
2. Go to `User & Authentication` → `SSO connections`.
3. Add or edit the Apple connection.
4. Use custom credentials for production.
5. Copy the production `Return URL` from Clerk again.
6. Do **not** assume the production Return URL matches development.
7. Confirm your production app environment still uses:
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
   - `CLERK_SECRET_KEY`
   - `CLERK_JWT_ISSUER_DOMAIN`

What you should see:

1. Apple enabled in the production Clerk instance
2. The production site showing Apple in the Clerk sign-in UI

## Troubleshooting

### Apple button does not appear in Clerk

Open first:

1. Clerk Dashboard → `User & Authentication` → `SSO connections`

Check:

1. Apple connection exists
2. `Enable for sign-up and sign-in` is on
3. You are looking at the correct Clerk instance, development versus production

### Apple redirects back with an error

Open first:

1. Clerk Dashboard Apple connection modal
2. Apple Developer → Services ID configuration

Check:

1. The Return URL matches exactly
2. The domain is correct
3. The domain field does not include `https://`
4. You did not paste a development callback into production, or the other way around

### “Invalid redirect URI” or domain mismatch

Open first:

1. Apple Developer → `Certificates, Identifiers & Profiles` → `Identifiers` → `Services IDs`

Check:

1. `Domains and Subdomains` contains the Clerk frontend domain without protocol
2. `Return URLs` contains the exact Clerk Return URL
3. The Services ID is connected to the correct Primary App ID

### Apple sign-in succeeds in Clerk but Curio Garden does not act signed in

Open first:

1. Convex dashboard for the deployment
2. Clerk Dashboard API / frontend values

Check:

1. `CLERK_JWT_ISSUER_DOMAIN` still matches the Clerk Frontend API URL
2. You are using the expected Clerk environment
3. Clerk-to-Convex integration was not accidentally pointed at the wrong instance

### Lost `.p8` file

Open first:

1. Apple Developer → `Certificates, Identifiers & Profiles` → `Keys`

Check:

1. Apple does not let you re-download the same private key
2. The normal recovery is to create a new key, download the new `.p8`, and update Clerk with the new Key ID and private key

### Wrong Apple Team or wrong Clerk instance confusion

Open first:

1. Clerk Dashboard instance switcher
2. Apple Developer account overview

Check:

1. You are editing the intended Clerk instance
2. You are signed into the intended Apple Developer team
3. The Team ID you pasted matches the App ID and key you created

## Native/TestFlight Note

> This guide is for the **web Clerk flow** in Curio Garden.
>
> The **Expo/TestFlight** app uses a different native Apple sign-in path.
>
> Reusing the web Services ID instructions there may be wrong.
>
> If you later want Apple sign-in in `surroundings-ai`, make a separate native-focused guide and use Clerk's Expo or iOS Sign in with Apple docs.

For the native app, start with Clerk's native Apple docs instead of this file.

## Helpful Links

1. Clerk web Apple social connection docs: https://clerk.com/docs/guides/configure/auth-strategies/social-connections/apple
2. Apple web Sign in with Apple configuration docs: https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web
3. Apple Services ID docs: https://developer.apple.com/help/account/identifiers/register-a-services-id
4. Apple private email relay docs: https://developer.apple.com/help/account/capabilities/configure-private-email-relay-service/
5. Clerk Expo native Apple docs: https://clerk.com/docs/expo/guides/configure/auth-strategies/sign-in-with-apple
