

For frontend:

src/
  app/ - general folder with page and routes
  api/ - axios requests to backend
    /index.ts - base axios instance to send requests
    [module-name] - fodler with api requests to specific module
      /index.ts - object with methods as keys to send request
  modules/ - main logic of the app separated to domains ( modules )
    [module-name] - logical domain
      containers/ - components with logic, api requests
      components/ - "silly" components with just ui and some handles or simple states
