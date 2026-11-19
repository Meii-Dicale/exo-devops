// FICHIER JETABLE (bonus étape 5) : la même injection qu'en .js, mais en CommonJS
// (require). Les règles p/nodejsscan ne reconnaissent que cette forme.
const express = require('express');
const pg = require('pg');

const pool = new pg.Pool();
const router = express.Router();

router.get('/recherche-cjs', (req, res) => {
  pool
    .query("SELECT * FROM tasks WHERE title = '" + req.query.q + "'")
    .then((result) => res.json(result.rows));
});

module.exports = { router };
