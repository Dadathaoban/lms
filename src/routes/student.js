const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { protectRoute } = require('../middleware/auth');

const studentOnly = protectRoute('student');

router.get('/dashboard', studentOnly, async (req, res) => {
    try {
        const profileQuery = await pool.query(
            `SELECT sp.class_id, c.class_name 
             FROM student_profiles sp
             JOIN classes c ON sp.class_id = c.id
             WHERE sp.user_id = $1`,
            [req.session.userId]
        );

        if (profileQuery.rows.length === 0) {
            return res.status(404).send('Student academic profile not found.');
        }

        const { class_id, class_name } = profileQuery.rows[0];

        const lessonsQuery = await pool.query(
            `SELECT l.id, l.title, s.subject_name, l.video_url, l.document_url 
             FROM lessons l
             JOIN subjects s ON l.subject_id = s.id
             WHERE l.class_id = $1
             ORDER BY s.subject_name ASC, l.created_at DESC`,
            [class_id]
        );

        const examsQuery = await pool.query(
            `SELECT 
                e.id, 
                e.title, 
                e.duration_minutes, 
                e.allowed_attempts,
                s.subject_name,
                (SELECT COUNT(*)::INT FROM questions q WHERE q.exam_id = e.id) as question_count,
                (SELECT COUNT(*)::INT FROM exam_attempts ea WHERE ea.exam_id = e.id AND ea.student_id = $1) as attempt_count,
                (SELECT MAX(score_percentage)::NUMERIC(5,2) FROM exam_attempts ea WHERE ea.exam_id = e.id AND ea.student_id = $1) as past_score
             FROM exams e
             JOIN subjects s ON e.subject_id = s.id
             WHERE e.class_id = $2
             ORDER BY e.created_at DESC`,
            [req.session.userId, class_id]
        );

        res.render('student/dashboard', {
            user: req.session,
            className: class_name,
            lessons: lessonsQuery.rows,
            exams: examsQuery.rows
        });
    } catch (err) {
        console.error('[STUDENT PORTAL ERROR]', err);
        res.status(500).send('Failed to initialize student workspace terminal.');
    }
});

router.get('/results', studentOnly, async (req, res) => {
    try {
        const studentId = req.session.userId;

        const resultsQuery = await pool.query(`
            SELECT 
                ea.id,
                e.title as exam_title,
                s.subject_name,
                ea.score_percentage as percentage,
                TO_CHAR(ea.created_at, 'YYYY-MM-DD HH24:MI:SS') as submission_date,
                COALESCE(ea.correct_answers_count, 0) as score_obtained,
                COALESCE(ea.total_questions_count, 0) as total_questions
            FROM exam_attempts ea
            JOIN exams e ON ea.exam_id = e.id
            JOIN subjects s ON e.subject_id = s.id
            WHERE ea.student_id = $1
            ORDER BY ea.created_at DESC
        `, [studentId]);

        res.render('student/results', {
            user: req.session,
            results: resultsQuery.rows
        });
    } catch (error) {
        console.error("[STUDENT METRICS FAULT]", error);
        res.status(500).send("Failed to pull secure academic profiles.");
    }
});

router.get('/exams/:id', studentOnly, async (req, res) => {
    const examId = req.params.id;
    const studentId = req.session.userId;
    try {
        const examQuery = await pool.query(
            `SELECT e.id, e.title, e.duration_minutes, e.allowed_attempts, c.class_name 
             FROM exams e
             JOIN classes c ON e.class_id = c.id
             WHERE e.id = $1`, 
            [examId]
        );
        if (examQuery.rows.length === 0) return res.status(404).send('Exam profile not found.');
        const examData = examQuery.rows[0];

        const attemptCheck = await pool.query(
            'SELECT COUNT(*)::INT as total_attempts FROM exam_attempts WHERE student_id = $1 AND exam_id = $2',
            [studentId, examId]
        );
        
        const attemptsUsed = attemptCheck.rows[0].total_attempts;
        const allowedAttempts = examData.allowed_attempts || 1;
        
        if (attemptsUsed >= allowedAttempts) {
            return res.status(403).send(`
                <div style="padding: 40px; font-family: 'Segoe UI', sans-serif; text-align: center;">
                    <h2 style="color: #dc3545;">Access Denied</h2>
                    <p style="font-size: 18px; margin: 20px 0;">
                        You have reached the maximum attempts (${allowedAttempts}) for this exam.
                    </p>
                    <a href="/student/dashboard" style="display: inline-block; padding: 10px 20px; background: #000; color: #fff; text-decoration: none; border-radius: 4px; margin-top: 20px;">
                        Return to Dashboard
                    </a>
                </div>
            `);
        }

        const questionsQuery = await pool.query(
            'SELECT id, question_text, option_a, option_b, option_c, option_d FROM questions WHERE exam_id = $1 ORDER BY id ASC',
            [examId]
        );

        if (questionsQuery.rows.length === 0) {
            return res.status(400).send('This exam has no questions configured yet.');
        }

        res.render('student/exam_room', {
            user: req.session,
            exam: examData,
            questions: questionsQuery.rows,
            attemptNumber: attemptsUsed + 1,
            totalAttemptsAllowed: allowedAttempts
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to initialize CBT exam room node.');
    }
});

router.post('/exams/:id/submit', studentOnly, async (req, res) => {
    const examId = req.params.id;
    const studentId = req.session.userId;

    let submittedAnswers = {};

    Object.keys(req.body).forEach(key => {
        if (key.startsWith('answer_')) {
            const questionId = key.replace('answer_', '');
            submittedAnswers[questionId] = req.body[key];
        }
    });

    try {
        const questionsQuery = await pool.query(
            'SELECT id, correct_option FROM questions WHERE exam_id = $1 ORDER BY id ASC',
            [examId]
        );
        
        const totalQuestions = questionsQuery.rows.length;
        if (totalQuestions === 0) {
            return res.status(400).send('Evaluation error: No questions active inside this exam profile.');
        }

        let correctCount = 0;
        const detailedResults = [];

        questionsQuery.rows.forEach((q, index) => {
            const rawStudentAnswer = submittedAnswers[q.id];
            
            const correctAnswer = String(q.correct_option).trim().toUpperCase();
            const studentAnswer = rawStudentAnswer ? String(rawStudentAnswer).trim().toUpperCase() : '';
            
            const isCorrect = studentAnswer === correctAnswer;
            if (isCorrect) {
                correctCount++;
            }

            detailedResults.push({
                questionNumber: index + 1,
                studentAnswer: studentAnswer || '(no answer)',
                correctAnswer: correctAnswer,
                isCorrect: isCorrect
            });
        });

        const scorePercentage = (correctCount / totalQuestions) * 100;

        await pool.query(
            `INSERT INTO exam_attempts 
             (student_id, exam_id, score_percentage, correct_answers_count, total_questions_count) 
             VALUES ($1, $2, $3, $4, $5)`,
            [studentId, examId, parseFloat(scorePercentage.toFixed(2)), correctCount, totalQuestions]
        );

        const examQuery = await pool.query('SELECT title FROM exams WHERE id = $1', [examId]);
        const examTitle = examQuery.rows[0]?.title || 'Assessment Component';

        res.render('student/exam_result', {
            examTitle: examTitle,
            scorePercentage: parseFloat(scorePercentage.toFixed(2)),
            correctCount: correctCount,
            totalQuestions: totalQuestions,
            detailedResults: detailedResults
        });
    } catch (err) {
        console.error('[CRITICAL SELECTION PARSING TRACE ERROR]:', err);
        res.status(500).send('Failed to parse assessment submission logs.');
    }
});

module.exports = router;
