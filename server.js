/*
 * Nebulae Chat Server
 *
 * This is a chat application in node using Socket.js written with the explicit
 * purpose of replacing cbox.ws on systems running Xenforo bulletin board.
 * I wrote this essentially because I got tired of paying the subscription
 * fee on my at-the-time girlfriend's forum site for a drop-in web chat.
 *
 * A core feature difference of this chat is that each forum user can appear
 * in chat as multiple "personas" with their own avatars. This was an
 * especially useful feature for forum roleplayers, as it was much less
 * trouble than having to change accounts constantly.
 *
 * This is the server code, written in node, with socket.io hooks. It's not
 * finished completely -- breaking up sort of took away my motivation to
 * continue -- but it is definitely something I wrote from nothing, to learn
 * a new technology and solve a specific problem.
 *
 * This requires the board to run XenAPI and for the install to have socket.io
 * in a sibling directory (ie '../socket'). As most real-world servers don't
 * use the highly outdated and insecure XenAPI anymore, this code is for
 * archival purposes only.
 *
 */

/* Constants */
var XF_SITE_HASH     = 'YTesFAERcau';
var XF_API_LOCATION  = 'http://redacted.net/api.php';

/* Global Variables */
var numUsers = 0;
networkData = {
  channels: {},
  users: {},
  avatars: {},
  links: {},
  namesAndIPs: {},
  namesAndSocketIDs: {},
  bannedIPs: []
};

/* Actual curse words redacted.
 * Would probably implement this array now using FileReadAsync or a database.
 */

badWords = [
['cinnamon bun', 'sugar cookie'], ['sinnamon bun','sugar cookie'],
['cinnamon roll','sugar cookie'], ['sinnamon roll','sugar cookie'],
['smol', 'small'], [' tol ', ' tall '],
[':\\^\\^\\^\\^\\^\\)','<img src="http://i.imgur.com/MpJHkpI.png" height=680 width=680>'],

/* experimental bbcode support */
['\\[b\\]','<strong>'],
['\\[i\\]','<i>'],
['\\[/b\\]','</strong>'],
['\\[/i\\]','</i>'],
['\\[s\\]','<s>'],
['\\[/s\\]','</s>']

];

/* Likewise the moderator config would probably come from a db or file read. */
globalModerators = ['Admin', 'Sysadmin', 'Moderator', 'Ranger'];

var ranks = {
  admin: {
    "power": 9999,
    "color": "#0099AA",
  },
  sysadmin: {
    "power": 7777,
    "color": "#AE56CC",
  },
  moderator: {
    "power": 5555,
    "color": "#AA0044",
  },
  ranger: {
    "power": 3333,
    "color": "#FD5E53",
  }
};

var serverStaff = {
  "Karen": "admin",
  "Anthony": "sysadmin",
  "Janet":"moderator",
  "Steve":"ranger",
};

/* Global Objects */
var express = require('express');
var app     = express();
var request = require('request');
var rq      = require('request-promise');

var server = require('http').createServer(app);
var io = require('../socket')(server);
var md5 = require('js-md5');
var port = process.env.PORT || 1025;

var namespace    = '/imaginaryserver';
var default_chat = 'Main_Chat';

var mysql = require('mysql');

var connection = mysql.createConnection({
  host     : process.env.DBHOST,
  user     : process.env.DBUSER,
  password : process.env.DBPASSWORD,
  database : process.env.DBNAME
});
connection.connect();

server.listen(port, function () {
  console.log('Server listening at port %d', port);

    var query = 'SELECT banned_ip FROM banned_ip;';

    connection.query(query, [], function(err, rows, fields) {
      if (err) {console.log(err); throw err;}
      else {
        for(i = 0; i < rows.length; i++) {
          networkData.bannedIPs[i] = rows[i].banned_ip;
        }
        console.log(rows.length + ' banned IPs loaded.');
      }
    });

    setInterval(keepalive, 180000); // 30 mins

    /* An "expedient solution" for service providers that didn't allow for
     * SQL connections of indeterminate length. :^)
     */
    function keepalive() {
        connection.query('SELECT 1 + 1 AS solution', function (err) {
          if (err) {
            console.log(err.code); // 'ER_BAD_DB_ERROR'
          }
          console.log('SQL Keepalive.');
        });
    }

});

/* Routing */
app.use(express.static(__dirname + ''));

/* Global Functions */
function md5token () {
  return Math.random().toString(36).substr(2); // remove `0.`
}

function filterWords (input) {
	filtered = input;
	for (i = 0; i < badWords.length; i++) {
		filterThis = new RegExp(badWords[i][0], "ig");
		filtered = filtered.replace( filterThis , badWords[i][1] );
	}
	return filtered;
}

/* The extremely short function names were for callback-only functions.
 * I did this because the libraries I was using also used this convention.
 * I think it's fallen out of vogue in favor of descriptive names everywhere,
 * and rightfully so.
 */
function authenticate(username, password, au) {
	var urlbits = '/?action=authenticate&username=' + username + '&password=' + password;

	var options = {
		uri: XF_API_LOCATION + urlbits,
		method: 'GET',
		json: {'action':'authenticate', 'username':username, 'password':password }
	}

	try {
		rq(options)
		.then(function(body){
				if ((body.error)) au(username,false);
				else au(username,body.hash);
		}).catch(function(err){
				au(username,false);
		});

	} catch(err) {
		console.log(err);
		au(username,false);
	}

}

function validateHash(username, hash, vh) {

	var urlbits = '/?action=getUser&value=' + username + '&hash=' + username + ':' + hash;

	var options = {
		uri: XF_API_LOCATION + urlbits,
		method: 'GET',
		json: {'action':'getUser', 'value':username, 'hash':(username + ':' + hash) }
	}

	try {
		rq(options)
		.then(function(body){
				if (!(body.error)) vh(username,true);
				else vh(username,false);
		}).catch(function(err){
				vh(username,false);
		});

	} catch (err) {
		console.log(err);
		vh(username,false);
	}

}

function existsUser(username, ue) {

	var urlbits = '/?action=getUser&value=' + username + '&hash=' + XF_SITE_HASH;

	var options = {
		uri: XF_API_LOCATION + urlbits,
		method: 'GET',
		json: {'action':'getUser', 'value':username, 'hash':XF_SITE_HASH }
	}

	try {

		rq(options)
		.then(function(body){
				if (!(body.error)) ue(username,true);
				else ue(username,false);
		}).catch(function(err){
				if (!(err.error)) ue(username,true);
				else ue(username,false);
		});

	} catch(err) {
		console.log(err);
		ue(username,true);
	}

}

function insert_persona (user_id, persona_name, avatar, link) {

  var query = 'insert into personas (user_id, persona_name, avatar, link, channels) values (?, ?, ?, ?, ?);';

  connection.query(query, [user_id, persona_name, avatar, link, '{}'], function(err, rows, fields) {
    if (err) {console.log(err); throw err;}
    else {
      socket.emit('data', {
        hash: 0,
        room: ' -SYSTEM- ',
        username: 'System',
        message: 'Persona with name ' + data.personaname + ' has been created. ' + user_id
      });
    }
  });

};

function randomUsername() {
	firstnames = ['Duane', 'Federico', 'Arden', 'William', 'Marlon',
	'Harry', 'Stanley', 'Clark', 'Isidro', 'Jonas', 'Bettie', 'Alice',
	'Dolores', 'Vera', 'Olympia', 'Eleanor', 'Beth', 'Sarita', 'Jennifer',
	'Jamila', 'Chance'];
	lastnames  = ['Viernes', 'Johansson', 'Leveille', 'Goulette', 'Smith',
	'Jones', 'Warr', 'Youngquist', 'Bowne', 'Spalla', 'Santodomingo',
	'Reuther', 'Volkert', 'Harvison', 'Mungia', 'Clermont', 'Bade',
	'Buckles', 'Flegle', 'Lebron', 'Chang', 'Goodman'];
	username = firstnames[Math.floor(Math.random()*firstnames.length)] + ' ' + lastnames[Math.floor(Math.random()*lastnames.length)];
	return username;
}

function randomAvatar() {
	avatars = ['http://i.imgur.com/tQQBJ0G.png'];
	return avatars[Math.floor(Math.random()*avatars.length)];
}

/* Socket Connection Instructions */

nsp = io.of(namespace);

nsp.on('connection', function (socket) {

  ++numUsers;

	socket.broadcast.emit('user joined', {
		username: socket.username,
		numUsers: numUsers
	});

	socket.username = randomUsername();
	socket.avatar = randomAvatar();
	socket.link = 'http://redacted.net/';

	socket.emit('handshake one', {
		room: ' -SYSTEM- ',
		username: 'System',
		nick: socket.username,
		avatar: socket.avatar,
    persona: 0,
		link: socket.link,
		numUsers: numUsers,
		message: 'You may now join your default channel.'
	});

  socket.iptoban = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address.address;

  for (i = 0; i < networkData.bannedIPs.length; i++) {
    if (socket.iptoban == networkData.bannedIPs[i]) {
      socket.emit('data', {
        room: ' -SYSTEM- ',
        username: 'System',
        message: 'You are banned from this network.'
      });
      console.log("Stopped a banned user from logging in at " + socket.iptoban);
      setTimeout(function(){socket.disconnect(true);}, 1000);
      return;
    }
  }

  networkData.namesAndIPs[socket.username] = socket.iptoban;
  networkData.namesAndSocketIDs[socket.username] = socket.id;

	socket.emit('data', {
		room: ' -SYSTEM- ',
		username: 'System',
		message: 'You have joined ' + namespace + '.<br>' + ''
	});

	socket.on('set nick', function (data) {

		socket.authenticated = false;

		filteredNick = filterWords((data.nick).toLowerCase());

		if (filteredNick.toLowerCase() != (data.nick).toLowerCase()) {
			socket.emit('data', {
				hash: 0,
				room: ' -SYSTEM- ',
				username: 'System',
				message: 'Nickname contains banned words.'
			});
			socket.emit('disconnect', {});
			data.nick = "Clarence";
		}

    delete networkData.namesAndIPs[String(socket.username)];
    delete networkData.namesAndSocketIDs[String(socket.username)];

		socket.username = data.nick || "No Name Provided";

    networkData.namesAndIPs[String(socket.username)] = socket.iptoban;
    networkData.namesAndSocketIDs[String(socket.username)] = socket.id;
	});

	socket.on('set avatar', function (data) {
		socket.avatar = data.avatar || randomAvatar();
	});

	socket.on('set link', function (data) {
		socket.link = data.link || 'http://redacted.net';
	});

  socket.on('set persona', function (data) {

    if (socket.authenticated) {
      socket.personaname = (data.name || (socket.username || "No Name Provided"));

      socket.emit('data', {
        hash: 0,
        room: ' -SYSTEM- ',
        username: 'System',
        message: 'Your name is set to ' + socket.personaname + '.'
      });

    }
    else {
      socket.emit('data', {
        hash: 0,
        room: ' -SYSTEM- ',
        username: 'System',
        message: 'You can\'t set a persona if you aren\'t authenticated.'
      });
    }

	});

	socket.on('join room', function (data) {
		socket.join((data.room || default_chat));

		var channel = ((data.room || default_chat));
		var topic = 'topic';
		var query = "SELECT topic FROM channels WHERE channel_name = ?;"

		connection.query(query, channel, function(err, rows, fields) {
			if (err) {
				throw err;
				socket.emit('channel topic', {
					channel : channel,
					topic: (topic || 'This channel has no topic set.')
				});

			} else if ((rows.length == 0) || (rows == null)) {
				socket.emit('channel topic', {
					channel : channel,
					topic: ('This channel has no topic set.')
				});
			} else {
				topic = rows[0].topic;
				socket.emit('channel topic', {
					channel : channel,
					topic: (topic || 'This channel has no topic.')
				});
			}
		});
	});

	socket.on('leave room', function (data) {
		socket.leave(data.room);
		socket.emit('data', {
			hash: 0,
			room: ' -SYSTEM- ',
			username: 'System',
			message: 'You have left ' + (data.room) + '.'
		});
	});

	socket.on('data', function (data) {

		data.room = (data.room || default_chat);
		var hash = md5token() + md5token();
		filteredMessage = filterWords(data.message);

		if (!(socket.authenticated)) {
			socket.emit('data',{
				username: 'System',
				message: 'You are not properly authenticated to this username.'
			})
			return;
		}

    var nameColor = "";

    var staffNumber = (Object.keys(serverStaff).indexOf(socket.username));
    if ( staffNumber > -1 ) {
      nameColor = ranks[serverStaff[socket.username]].color;
    }

		socket.broadcast.to(data.room).emit('data', {
			hash: hash,
			room: data.room,
			avatar: socket.avatar,
			link: socket.link,
      unixtime: Math.floor(Date.now() / 1000),
			username: (socket.personaname || (socket.username || "User")),
      color: ((nameColor != "") ? nameColor : "inherit" ),
			message: filteredMessage
		});

		socket.emit('data', {
			hash: hash,
			room: data.room,
			avatar: socket.avatar,
			link: socket.link,
      unixtime: Math.floor(Date.now() / 1000),
			username: (socket.personaname || (socket.username || "User")),
      color: ((nameColor != "") ? nameColor : "inherit" ),
			message: filteredMessage
		});

    var queryArray = [
      namespace,
      data.room,
      socket.username,
      (socket.personaname || (socket.username || "User")),
      hash,
      filteredMessage,
      (socket.avatar || ''),
      (socket.link || '')
    ];
		var query = "INSERT INTO history (network,channel,user,persona,hash,message,avatar,link) values (?,?,?,?,?,?,?,?);";
		connection.query(query, queryArray, function(err, rows, fields) {
			if (err) {console.log(err); throw err;}
		});

	});

	socket.on('history request', function (data) {

		var query = "SELECT hash, channel, persona, UNIX_TIMESTAMP(time) AS unixtime, message, avatar, link FROM history WHERE channel = ? ORDER BY message_id DESC LIMIT 10;"

		connection.query(query, data.channel, function(err, rows, fields) {
			if (err) {console.log(err); throw err;}

			console.log("History check for channel " + data.channel);
			for(i = (rows.length - 1); i >= 0; i--) {

        var nameColor = "";
        var persona = rows[i].persona;

        var staffNumber = (Object.keys(serverStaff).indexOf(persona));

        if ( staffNumber > -1 ) {
          nameColor = ranks[serverStaff[persona]].color;
        }

				socket.emit('data', {
					hash: rows[i].hash,
					room: rows[i].channel,
					username: rows[i].persona,
          color: ((nameColor != "") ? nameColor : "inherit" ),
          unixtime: rows[i].unixtime,
					message: rows[i].message,
					avatar: rows[i].avatar,
					link: rows[i].link
				});

			}

		});

	});

  socket.on('persona request', function (data) {

    /* This JOIN gives me conniptions. */
    var query  = "SELECT personas.persona_id as persona_id, ";
        query += "personas.persona_name as persona_name, ";
        query += "personas.avatar as avatar, ";
        query += "personas.link as link, ";
        query += "personas.channels as channels FROM personas ";
        query += "JOIN users ON personas.user_id = users.user_id ";
        query += "WHERE users.username = ?;";

    connection.query(query, data.username, function(err, rows, fields) {
      if (err) {console.log(err); throw err;}
      newdata = {};
      newdata.rows = [];
      for(i = (rows.length - 1); i >= 0; i--) {
        newdata.rows[i] = {};
        newdata.rows[i].id = rows[i].persona_id;
        newdata.rows[i].name = rows[i].persona_name;
        newdata.rows[i].avatar = rows[i].avatar;
        newdata.rows[i].link = rows[i].link;
        socket.emit('persona', {
          id: rows[i].persona_id,
          name: rows[i].persona_name,
          avatar: rows[i].avatar,
          link: rows[i].link
        });
      }

      socket.emit('persona list', {
        data: newdata.rows
      });
    });

  });

  socket.on('persona create request', function (data) {
    if (socket.authenticated != true ) {
      socket.emit('data',{
        username: 'System',
        message: 'Only authenticated users may create personas.'
      })
      return;
    }

    var pers = {'name':data.personaname, 'avatar':data.avatar, 'link': data.link};
    var user = {'name':socket.username, 'avatar':socket.avatar, 'link':socket.link};

    /* This is a chain of callbacks to get user id, make user, and make persona.
     * In modern JS I'd have implemented this with promises or async/await.
     */
    function gid (persona, user, make_user, make_persona) {
      var query = "SELECT user_id, username FROM users WHERE username = ?;"
      console.log(query);

      connection.query(query, [user.name], function(err, rows, fields) {
        if (err) {console.log(err); console.log('error in get user id');  throw err;}
        else if ((rows.length == 0) || (rows == null)) {
          console.log('Looks like we didn\'t find anyone named ' + user.name + '.');
          make_user(persona,user,make_persona);
        }
        else {
          console.log('Got user ' + user.name + ' with id ' + rows[0].user_id);
          console.log(rows);
          make_persona(persona, rows[0].user_id); }
      });
    }

    function mkusr (persona, user, make_persona) {
      var query = 'INSERT INTO users (username, avatar, link, channels) VALUES (?,?,?,"{}");';
      connection.query(query, [user.name, user.avatar, user.link], function(err, rows, fields) {
        if (err) {console.log(err); console.log('error in create user'); throw err;}
        console.log('Made user.');
        console.log(fields);
        console.log(rows);
        console.log(rows[0]);
        make_persona(persona, rows.insertId);
      });

    }

    function mkprsn(persona, user_id) {
      var query = 'insert into personas (user_id, persona_name, avatar, link, channels) values (?,?,?,?,"{}");';
      connection.query(query, [user_id,persona.name,persona.avatar,persona.link], function(err, rows, fields) {
        if (err) {console.log(err); throw err;}
        else {
          socket.emit('data', {
            hash: 0,
            room: ' -SYSTEM- ',
            username: 'System',
            message: 'Persona with name ' + data.personaname + ' has been created. ' + user_id
          });
        }
      });
    }

    gid(pers,user,mkusr,mkprsn);
  });

  socket.on('persona delete request', function (data) {
    if (socket.authenticated != true ) {
      console.log('User is not authenticated.');
      socket.emit('data',{
        username: 'System',
        message: 'Only authenticated users may delete personas.'
      })
      return;
    }

  function plq(user_id) {

    var query = "SELECT persona_id, persona_name, avatar, link, channels FROM personas WHERE user_id = ?;"

    connection.query(query, user_id, function(err, rows, fields) {
      if (err) {console.log(err); throw err;}

      console.log("Persona List for " + socket.username);
      newdata = {};
      newdata.rows = [];
      for(i = (rows.length - 1); i >= 0; i--) {
        newdata.rows[i] = {};
        newdata.rows[i].id = rows[i].persona_id;
        newdata.rows[i].name = rows[i].persona_name;
        newdata.rows[i].avatar = rows[i].avatar;
        newdata.rows[i].link = rows[i].link;
        socket.emit('persona', {
          id: rows[i].persona_id,
          name: rows[i].persona_name,
          avatar: rows[i].avatar,
          link: rows[i].link
        });
      }

      socket.emit('persona list', {
        data: newdata.rows
      });

      console.log(newdata.rows);
    });

  }

  function gtid (persona, user, delete_persona, persona_list_query) {
    var query = "SELECT user_id, username FROM users WHERE username = ?;"
    console.log(query);

    connection.query(query, [user], function(err, rows, fields) {
      if (err) {console.log(err); console.log('error in get user id');  throw err;}
      else if ((rows.length == 0) || (rows == null)) {
        console.log('Looks like we didn\'t find anyone named ' + user + '.');
        return;
      } else {
        console.log('Got user ' + user + ' with id ' + rows[0].user_id);
        console.log(rows);
        delete_persona(persona, rows[0].user_id, persona_list_query);
      }
    });
  }

  function dlprsn(persona, user_id, persona_list_query) {

    var query = "DELETE FROM personas WHERE user_id = ? and persona_name = ?;";
    connection.query(query, [user_id, persona], function(err, rows, fields) {
      if (err) {console.log(err); throw err;}
      else {
        socket.emit('data', {
          hash: 0,
          room: ' -SYSTEM- ',
          username: 'System',
          message: 'Persona with name ' + data.personaname + ' has been deleted. You have been returned to your default persona.'
        });
        persona_list_query(user_id);
      }
    });

  }

  gtid(data.personaname,socket.username,dlprsn,plq);
  });


	socket.on('delete request', function (data) {

		console.log('Delete request from ' + socket.username + ' for ' + data.hash);
		if (socket.authenticated != true ) {console.log('User is not authenticated.'); return;}
    if ( (Object.keys(serverStaff).indexOf(socket.username)) == -1) return;
		var query = "DELETE FROM history WHERE hash = ?;"

		connection.query(query, data.hash, function(err, rows, fields) {
			if (err) {console.log(err); throw err;}
		});

		socket.emit('delete command', {
			hash: data.hash
		});
		socket.emit('data', {
			hash: 0,
			room: ' -SYSTEM- ',
			username: 'System',
			message: 'Message with hash ' + data.hash + ' has been deleted.'
		});
		socket.broadcast.emit('delete command', {
			hash: data.hash
		});

	});

  socket.on('ban request', function (data) {

    console.log('Banned request from ' + socket.username + ' for ' + data.banneduser);
    if (socket.authenticated != true ) {console.log('User is not authenticated.'); return;}
    if ( (Object.keys(serverStaff).indexOf(socket.username)) == -1) return;

    Object.keys(io.sockets.sockets).forEach(function(id) {
      console.log("ID:",id)
    });

    console.log("Banned User: " + data.banneduser);
    console.log(networkData.namesAndIPs);
    console.log(networkData.namesAndSocketIDs);

    var banVictim = networkData.namesAndIPs[data.banneduser];
    if (!(banVictim)) {console.log("Ban victim doesn't appear in the list of users with IPs."); return;}

    var shortSocketId = (networkData.namesAndSocketIDs[data.banneduser]).substring(networkData.namesAndSocketIDs[data.banneduser].indexOf('#')+1);
    var socketToKill = io.sockets.connected[shortSocketId];
    if (socketToKill) {
      socketToKill.emit('data', {
        hash: 0,
        room: ' -SYSTEM- ',
        username: 'System',
        message: 'You have been banned from the server.'
      });
      setTimeout(function(){socketToKill.disconnect(true);},1000)
      console.log("Banned user has been disconnected.");
    }
    else {console.log("Couldn't find that socket using the socketID matching that username.")};

    networkData.bannedIPs[networkData.bannedIPs.length] = banVictim;
    var query = "INSERT INTO banned_ip (banned_ip) VALUES (?);"

    connection.query(query, banVictim, function(err, rows, fields) {
      if (err) {console.log(err); throw err;}
    });

    socket.emit('data', {
      hash: 0,
      room: ' -SYSTEM- ',
      username: 'System',
      message: 'User ' + data.banneduser + ' has been banned.'
    });

  });

	socket.on('disconnect', function () {

		--numUsers;

		socket.broadcast.emit('user left', {
			username: socket.username,
			numUsers: numUsers
		});

	});

	/* Validation and Debugging */
	socket.on('does user exist', function (data) {

		// callback for checking if user exists. Included here for clarity
		function ue (username, result) {
			if (result) {
				socket.emit('data', {
					username: 'System',
					message: 'User ' + data.username + ' exists. User with associated password may use this name.'
				});
			} else {
				socket.emit('data', {
					username: 'System',
					message: 'User ' + data.username + ' does not exist. User is free to use.'
				});
				socket.authenticated = true;
				socket.emit('set permitted');
			}
		}

		existsUser(socket.username, ue);

	});

	socket.on('authenticate', function (data) {

		// callback for checking if user/pass match. Included here for clarity
		function au (username, result) {

			if (result) { // maybe returns undefined?
				socket.emit('set hash', {
					hash: result
				});
				socket.hash = result;
				socket.authenticated = true;

        socket.emit('data', {
          username: 'System',
          message: 'User has successfully authenticated.'
        });

			} else {
				socket.emit('data', {
					username: 'System',
					message: 'No authentication to this username.'
				});
			}
		}

		authenticate(data.username, data.password, au);

	});

	socket.on('validate hash', function (data) {

    /* This section was where I left off. It's just for debugging
     * Whether the hash function was working or not by client message.
     * The vh() callback by itself is sufficient to actually validate and
     * does where it's required.
     *
     * Nowadays I'd probably have debug flags from process.env to determine
     * whether or not log messages should .emit() and return.
     */
		function vh (username, result) {
			if (result) {
				socket.emit('data', {
					username: 'System',
					message: 'User ' + username + ' matches the given hash.'
				});
			} else {
				socket.emit('data', {
					username: 'System',
					message: 'User ' + username + ' does not match the given hash.'
				});
			}
		}

		validateHash(socket.username, data.hash, vh);
	});

});

/* End */
