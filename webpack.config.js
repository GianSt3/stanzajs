const path = require('path');
var CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
  entry: './app.js',
  mode: 'production',
  target: 'node',
  output: {
    filename: 'stanzajs.js',
    path: path.join(__dirname, 'dist'),
  },



  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        { from: path.resolve('./views'), to: 'views' },
      ]
    }),
  ],

 
};