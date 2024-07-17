CREATE TYPE tags as ENUM ('os', 'memory', 'architecture');
CREATE TABLE posts (
	id SERIAL PRIMARY KEY,
	title VARCHAR(255) NOT NULL,
	content TEXT NOT NULL,
	summary TEXT NOT NULL,
	tags tags[] NOT NULL 
	last_modified DATE NOT NULL
);
