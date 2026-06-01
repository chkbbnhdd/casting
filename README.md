# AngularCastWebapp

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 20.0.2.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Netlify Deployment

This repository includes a `netlify.toml` configured for Angular production builds.

- Build command: `npm run build`
- Publish directory: `dist/angular-cast-webapp/browser`
- Node version: `22`

For a manual deploy check, run:

```bash
npm install
npm run build
```

Then deploy the repository in Netlify. SPA fallback routing is already configured.

## Custom Receiver

This repo now includes a minimal CAF Web Receiver as a dedicated Angular route at `/receiver`.

- Receiver page URL after deploy: `/receiver`
- Local preview URL during `ng serve`: `http://localhost:4200/receiver`
- Sender override query parameter: `castAppId`

To use the custom receiver end to end:

1. Host the app over HTTPS.
2. Register the deployed `/receiver` URL in the Google Cast Developer Console as a Custom Web Receiver.
3. Open the sender with `?castAppId=<YOUR_RECEIVER_APP_ID>`.
4. Use `?castReceiver=default` if you want to force the stock Default Media Receiver instead.

The sender now includes the full queue payload in Cast `customData`, and the routed receiver component uses that to show queue state and the selected item.

## Running unit tests

To execute unit tests with the [Karma](https://karma-runner.github.io) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
