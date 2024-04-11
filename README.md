# StanzaJS

## Run

Set the ENV variables or put the json file downloaded from Google Cloud Platform in the same folder of the project. The name has to be "client_secret.json". Just renaming it, or set the environment variables.

```bash
set CLIENT_ID="client_id_from_google"
set CLIENT_SECRET="client_secret_from_google"
node app.js
```

A local server would start on port 3000 (you can change it using env variable `PORT`) and the websocket server would start on port 8042 (you can change this too, with env `WSS_PORT`)

Open the browser to [http:localhost:3000](http:localhost:3000) and click _login_.

If everything goes right you will see another page where to copy-paste the id of the **your** current youtube live.

Click submit and magic would happen (hope so).

PS: Keep an eye on the console.

## Troubleshooting

#### Invalid Credentials

Try using the **client_secret.json** file instead of **env** variables.
