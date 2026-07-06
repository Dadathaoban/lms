-- ============================================================
-- schema.sql — Reconstructed from codebase SQL queries
-- Database: PostgreSQL
-- ============================================================

CREATE TABLE classes (
    id          SERIAL PRIMARY KEY,
    class_name  VARCHAR(100) NOT NULL
);

CREATE TABLE subjects (
    id            SERIAL PRIMARY KEY,
    subject_name  VARCHAR(100) NOT NULL
);

CREATE TABLE users (
    id              SERIAL PRIMARY KEY,
    username        VARCHAR(50)  NOT NULL UNIQUE,
    full_name       VARCHAR(100) NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    role            VARCHAR(20)  NOT NULL CHECK (role IN ('admin', 'student')),
    account_status  VARCHAR(20)  NOT NULL DEFAULT 'active'
                                   CHECK (account_status IN ('active', 'frozen', 'deleted')),
    last_login      TIMESTAMP    NULL,
    deleted_at      TIMESTAMP    NULL
);

CREATE TABLE student_profiles (
    id            SERIAL PRIMARY KEY,
    user_id       INTEGER      NOT NULL UNIQUE,
    class_id      INTEGER      NOT NULL,
    parent_phone  VARCHAR(20)  NULL,

    CONSTRAINT fk_student_profiles_user
        FOREIGN KEY (user_id)  REFERENCES users(id)    ON DELETE CASCADE,
    CONSTRAINT fk_student_profiles_class
        FOREIGN KEY (class_id) REFERENCES classes(id)   ON DELETE RESTRICT
);

CREATE TABLE lessons (
    id            SERIAL PRIMARY KEY,
    title         VARCHAR(200) NOT NULL,
    subject_id    INTEGER      NOT NULL,
    class_id      INTEGER      NOT NULL,
    video_url     TEXT         NULL,
    document_url  TEXT         NULL,
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_lessons_subject
        FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE RESTRICT,
    CONSTRAINT fk_lessons_class
        FOREIGN KEY (class_id)   REFERENCES classes(id)  ON DELETE RESTRICT
);

CREATE TABLE exams (
    id               SERIAL PRIMARY KEY,
    title            VARCHAR(200) NOT NULL,
    subject_id       INTEGER      NOT NULL,
    class_id         INTEGER      NOT NULL,
    duration_minutes INTEGER      NOT NULL CHECK (duration_minutes > 0),
    allowed_attempts INTEGER      NOT NULL DEFAULT 1 CHECK (allowed_attempts > 0),
    created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_exams_subject
        FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE RESTRICT,
    CONSTRAINT fk_exams_class
        FOREIGN KEY (class_id)   REFERENCES classes(id)  ON DELETE RESTRICT
);

CREATE TABLE questions (
    id              SERIAL PRIMARY KEY,
    exam_id         INTEGER      NOT NULL,
    question_text   TEXT         NOT NULL,
    option_a        VARCHAR(500) NOT NULL,
    option_b        VARCHAR(500) NOT NULL,
    option_c        VARCHAR(500) NOT NULL,
    option_d        VARCHAR(500) NOT NULL,
    correct_option  CHAR(1)      NOT NULL CHECK (correct_option IN ('A', 'B', 'C', 'D')),

    CONSTRAINT fk_questions_exam
        FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE
);

CREATE TABLE exam_attempts (
    id                    SERIAL PRIMARY KEY,
    student_id            INTEGER       NOT NULL,
    exam_id               INTEGER       NOT NULL,
    score_percentage      NUMERIC(5,2)  NOT NULL DEFAULT 0,
    correct_answers_count INTEGER       NOT NULL DEFAULT 0,
    total_questions_count INTEGER       NOT NULL DEFAULT 0,
    created_at            TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_exam_attempts_student
        FOREIGN KEY (student_id) REFERENCES users(id)  ON DELETE CASCADE,
    CONSTRAINT fk_exam_attempts_exam
        FOREIGN KEY (exam_id)    REFERENCES exams(id)  ON DELETE CASCADE
);

-- Indexes for frequent query patterns
CREATE INDEX idx_users_username        ON users(username);
CREATE INDEX idx_users_role            ON users(role);
CREATE INDEX idx_users_deleted_at      ON users(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_student_profiles_user ON student_profiles(user_id);
CREATE INDEX idx_lessons_class         ON lessons(class_id);
CREATE INDEX idx_lessons_subject       ON lessons(subject_id);
CREATE INDEX idx_exams_class           ON exams(class_id);
CREATE INDEX idx_exams_subject         ON exams(subject_id);
CREATE INDEX idx_questions_exam        ON questions(exam_id);
CREATE INDEX idx_exam_attempts_student ON exam_attempts(student_id);
CREATE INDEX idx_exam_attempts_exam    ON exam_attempts(exam_id);
CREATE INDEX idx_exam_attempts_student_exam ON exam_attempts(student_id, exam_id);
