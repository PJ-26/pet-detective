const express = require('express');
const mysql = require('mysql');
require('dotenv').config();
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const GoogleAuth = require('google-auth-library');
const utilities = require('./utils/searchUtils');

const app = express();
const { PORT, DB, DB_USER, DB_PASSWORD, GOOGLE_API_KEY, OAUTH_ID, MY_SECRET } = process.env;

const config = {
  host: DB,
  user: DB_USER,
  password: DB_PASSWORD,
  database: 'petdetective',
};

const connection = mysql.createConnection({
  host: DB,
  user: DB_USER,
  password: DB_PASSWORD,
  database: 'petdetective',
});

const auth = new GoogleAuth();
const client = new auth.OAuth2(OAUTH_ID, '', '');

app.use(express.static('client'));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

connection.connect((err) => {
  console.warn(err || `succesfully connected to DB ${DB}`);
});

/* eslint-disable */
app.listen(PORT, () => console.log('listening on', PORT)); 
/* eslint-enable */

const userInfo = {
  currentUser: '',
  photo: '',
};


app.get('/bulletin', (req, res) => {
  connection.query('select * from petpost', (err, posts) => {
    if (err) {
      res.send(err);
    } else {
      connection.query('select * from comments', (error, comments) => {
        const objectRows = comments.reduce((prev, current) => {
          if (!prev[current.postId]) {
            prev[current.postId] = [];
          }
          prev[current.postId].push(current);
          return prev;
        }, {});

        const combined = posts.map((e) => {
          if (objectRows[e.id]) {
            e.comments = objectRows[e.id].reverse();
          }
          return e;
        });

        res.send(combined);
      });
    }
  });
});

app.post('/bulletin', (req, res) => {
  connection.query(`insert into petpost (lostOrFound, type, styles, address, message, date, latlong, user, userpic, petPic) values ('${req.body.lostOrFound}', '${req.body.type}','${req.body.styles}', '${req.body.address}', '${req.body.message}', '${req.body.date}', '${req.body.latlong}', '${req.body.user}', '${req.body.userpic}', '${req.body.petPic}')`, function (err) {
    if (err) {
      console.error(err);
    }
  });
  res.sendStatus(201);
});

const getComments = (res, posts) => {
  const postIdList = posts.map(e => e.id).join(',');
  connection.query(`select * from comments where postId in (${postIdList}) `, (error, comments) => {
    if (error) {
      console.error(error);
    }
    const objectRows = comments.reduce((prev, current) => {
      if (!prev[current.postId]) {
        prev[current.postId] = [];
      }
      prev[current.postId].push(current);
      return prev;
    }, {});
    posts.forEach((e) => {
      if (objectRows[e.id]) {
        e.comments = objectRows[e.id].reverse();
      }
    });
    res.send(posts);
  });
};

app.post('/comments', (req, res) => {
  const { comment, senderEmail, postId, time, name } = req.body;
  connection.query(`insert into comments (postId, name, message, time, senderEmail) values ('${postId}', '${name}', '${comment}', '${time}', '${senderEmail}')`, (err) => {
    if (err) {
      console.error(err);
    } else {
      connection.query(`select * from comments where postId = ${postId}`, (error, comments) => {
        if (error) {
          console.error(error);
        } else {
          res.send(comments);
        }
      });
    }
  });
});

app.post('/search', (req, res) => {
  const { searchLocation, searchDistance, searchAnimalType, searchTags } = req.body;
  if (!searchDistance) {
    connection.query(
      `select * from petpost where 
      address like '%${searchLocation}%'`,
      (err, rows) => {
        if (err) {
          res.send(err);
        } else {
          getComments(res, rows);
        }
      });
  } else {
    utilities.getCoords(searchLocation, GOOGLE_API_KEY)
      .then((result) => {
        // console.log(result);
        const { results: [{ geometry: { location: { lat, lng } } }] } = JSON.parse(result);
        utilities.radiusSearch(lat, lng, searchDistance, (error, searchResults) => {
          if (error) {
            res.send(error);
          } else {
            getComments(res, searchResults);
          }
        }, connection);
      });
  }
});

app.post('/tokensignin', function (req, res) {
  client.verifyIdToken(
    req.body.idtoken,
    OAUTH_ID,
    // Or, if multiple clients access the backend:
    // [CLIENT_ID_1, CLIENT_ID_2, CLIENT_ID_3],
    function (e, login) {
      let token;
      const payload = login.getPayload();
      userInfo.currentUser = payload.email;
      userInfo.photo = payload.picture;
      if (payload) {
        token = jwt.sign(payload, MY_SECRET);
      }
      connection.query(`select * from users where email = '${payload.email}'`, (err, data) => {
        if (!data.length) {
          connection.query(`insert into users (email, picture, first_name, last_name) values ('${payload.email}','${payload.picture}','${payload.given_name}','${payload.family_name}')`);
          res.status(200).send(token);
        } else {
          res.status(200).send(token);
        }
      });
      // If request specified a G Suite domain:
      // var domain = payload['hd'];
    });
});

app.post('/deletePost', (req, res) => {
  connection.query(`select * from petpost where user='${req.body.user}' and message='${req.body.message}'`, (err, data) => {
    if (err) { console.error(err); }
    if (data.length) {
      connection.query(`DELETE from petpost where user='${req.body.user}' and message='${req.body.message}'`);
      res.send(data);
    } else {
      res.end();
    }
  });
});

