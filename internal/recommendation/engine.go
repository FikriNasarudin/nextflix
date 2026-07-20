package recommendation

import (
	"database/sql"
	"log"
	"time"
)

type Engine struct {
	db *sql.DB
}

func NewEngine(db *sql.DB) *Engine {
	return &Engine{db: db}
}

func (e *Engine) Start() {
	go e.run()
}

func (e *Engine) run() {
	e.refresh()
	ticker := time.NewTicker(1 * time.Hour)
	defer ticker.Stop()
	for range ticker.C {
		e.refresh()
	}
}

func (e *Engine) refresh() {
	log.Println("Recommendation: refreshing cache")

	profiles, err := e.listProfiles()
	if err != nil {
		log.Printf("Recommendation: list profiles error: %v", err)
		return
	}

	for _, pid := range profiles {
		e.refreshProfile(pid)
	}
}

func (e *Engine) refreshProfile(profileID int64) {
	e.computeBecauseYouWatched(profileID)
	e.computeTrending(profileID)
}

func (e *Engine) computeBecauseYouWatched(profileID int64) {
	rows, err := e.db.Query(`
		SELECT mi.id, COUNT(mt.tag_id) AS score
		FROM media_items mi
		JOIN media_tags mt ON mt.media_id = mi.id
		WHERE mt.tag_id IN (
			SELECT DISTINCT mt2.tag_id
			FROM watch_history wh
			JOIN media_tags mt2 ON mt2.media_id = wh.media_id
			WHERE wh.profile_id = ? AND wh.is_completed = 1
		)
		AND mi.id NOT IN (
			SELECT media_id FROM watch_history WHERE profile_id = ?
		)
		AND (mi.library_id IN (
			SELECT library_id FROM profile_library_access WHERE profile_id = ?
		) OR NOT EXISTS (
			SELECT 1 FROM profile_library_access WHERE profile_id = ?
		))
		GROUP BY mi.id
		ORDER BY score DESC
		LIMIT 20
	`, profileID, profileID, profileID, profileID)
	if err != nil {
		log.Printf("Recommendation: because_you_watched query error (profile=%d): %v", profileID, err)
		return
	}
	defer rows.Close()

	e.db.Exec(`DELETE FROM profile_recommendations WHERE profile_id = ? AND section = 'because_you_watched'`, profileID)

	for rows.Next() {
		var mediaID int64
		var score float64
		rows.Scan(&mediaID, &score)
		e.db.Exec(
			`INSERT INTO profile_recommendations (profile_id, section, media_id, score) VALUES (?, 'because_you_watched', ?, ?)`,
			profileID, mediaID, score,
		)
	}
}

func (e *Engine) computeTrending(profileID int64) {
	rows, err := e.db.Query(`
		SELECT mi.id, COUNT(wh.id) AS score
		FROM watch_history wh
		JOIN media_items mi ON mi.id = wh.media_id
		WHERE wh.is_completed = 1
		  AND wh.watched_at > datetime('now', '-7 days')
		  AND (mi.library_id IN (
			  SELECT library_id FROM profile_library_access WHERE profile_id = ?
		  ) OR NOT EXISTS (
			  SELECT 1 FROM profile_library_access WHERE profile_id = ?
		  ))
		GROUP BY mi.id
		ORDER BY score DESC
		LIMIT 20
	`, profileID, profileID)
	if err != nil {
		log.Printf("Recommendation: trending query error (profile=%d): %v", profileID, err)
		return
	}
	defer rows.Close()

	e.db.Exec(`DELETE FROM profile_recommendations WHERE profile_id = ? AND section = 'trending'`, profileID)

	for rows.Next() {
		var mediaID int64
		var score float64
		rows.Scan(&mediaID, &score)
		e.db.Exec(
			`INSERT INTO profile_recommendations (profile_id, section, media_id, score) VALUES (?, 'trending', ?, ?)`,
			profileID, mediaID, score,
		)
	}
}

func (e *Engine) listProfiles() ([]int64, error) {
	rows, err := e.db.Query(`SELECT id FROM profiles WHERE id IN (SELECT DISTINCT profile_id FROM watch_history WHERE is_completed = 1)`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []int64
	for rows.Next() {
		var id int64
		rows.Scan(&id)
		ids = append(ids, id)
	}
	return ids, nil
}
