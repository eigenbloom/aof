// Override node.js require()
/*var require = require('amdrequire');

require.config({
    paths: {

    },
    basePath: ".",
});*/

var http = require('http');
	io   = require('socket.io');
	fs   = require('fs');
	util = require('util');
	path = require('path');

// Command line options and defaults	
var argv = require('optimist')
					.default('h', 4)
					.default('v', 2)
					.default('debug', false)
					.default('local', false)
					.argv;
		
var PORT_NO = 4000;
			
var hPlayers = argv.h,
	vPlayers = argv.v,
	inDebugMode = argv.debug,
	isLocal = argv.local;

var Vec2 = require('./Vec2');
var Entity = require('./Entity');
var discrete = require('./discrete');
var team = require('./Team');
var Event = require('./Event');
var Lobby = require('./Lobby');
var Game = require('./Game');
var Man = require('./Man');
var AOFClient = require( './AOFClient' );

var MAX_LATENCY = 50; // milliseconds

var clients = [];

/*
	Server Class
*/
var server = http.createServer(function(request, response) {
	var contentType = 'text/html';
	var filePath = '.' + request.url;
	var extname = path.extname(filePath);

	console.log( request.url );

	switch (extname) {
		case '.js':
			contentType = 'text/javascript';
			break;
		case '.css':
			contentType = 'text/css';
			break;
	}

	var file = fs.readFile( filePath, function( err, data ) { 
		if ( err ) {
			console.log( "File not found: " + filePath );
			throw err;
		}

		response.writeHead(200, {
			'Content-Type': contentType
		});

		response.write( data );

		response.end();
	});

	//var rs = fs.createReadStream(filePath).pipe( response );	

}).listen(PORT_NO);

var sio = io.listen(server, {log: 'false'});

sio.set('log level', 1);
	
var clientnum = 0;

var lobby = new Lobby();

lobby.setDefaultPlayerCount( hPlayers, vPlayers );

sio.sockets.on('connection', function( client ) {
	console.log("New Client");

	newClient = new AOFClient( client );
	clients.push( newClient );

	clientnum++;
	
	newClient.setLobby( lobby );

	console.log('Client joined from ' + client.handshake.address );
});

var update = function() {

	// Add new games
	if ( lobby.games.length == 0 ) {
		lobby.addRandomGame();
	}

	// Update games in progress
	for (g in lobby.games) {
		var game = lobby.games[g];	

		if ( game != null ) game.update();
	
		// Prepare data to send	
		for (p in game.players) {
			game.players[p].makePacket();
		}
	}

	// Send game data to clients	
	for (c in clients) {
		client = clients[c];

		// If the client recently pinged back
		if (client.latency == 0) {

			// Send game data 
			if (client.game != null) {

				// Game data consistst of:
	
				// Each player
				for (p in client.game.players) {
					client.emit('player', client.game.players[p].getPacket());
				}

				// Score, any recent events
				client.emit('gameData', client.game.data);
				
				// Ball location
				client.emit('ball', client.game.ball);
				
				// Any queued packets
				client.game.sendPackets( client );
			
				if ( client.game.removeThis ) client.game = null;
			}

			// Ping the client again
			client.emit('marco', null);
		}

		// If the client is in a game, calculate their latency (resets to 0 when the player pings back)
		if (client.game != null) client.msecsSinceLastPing += 1;
		if (client.player != null) client.player.msecsSinceLastPing = client.msecsSinceLastPing;
	}

	// Remove completed games
	for (g in lobby.games) {
		if ( lobby.games[g].removeThis ) {
			// Remove game from list
			lobby.games.splice(g, 1);
			// Boot clients
		}
	}

	// Drop unresponsive clients
	for (c in clients) {
		client = clients[c];
	
		// If the client's latency is too high, drop them from the server
		if (client.msecsSinceLastPing > MAX_LATENCY) {
		
			if (client.game != null && client.player != null) {

				// Remove the client's player from whatever game they are in
				client.game.removePlayer(client.player);

				// Order all other clients to kill that player
				client.broadcast('kill', client.playerid);
			}

			// Drop the client
			clients.splice(c, 1);
		}		
	}
}
var updateInterval = setInterval(update, 40);

// Update the official time of each game once per second
var updateTimes = function() {
	for (g in lobby.games) {
		lobby.games[g].updateTime();
	}
}
var updateTimeInterval = setInterval(updateTimes, 1000);
