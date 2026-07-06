const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const upload = require('../middleware/upload');
const { protectRoute } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

const adminOnly = protectRoute('admin');

// ------------------------------------------
// Dashboard
// ------------------------------------------
router.get('/dashboard', adminOnly, (req, res) => {
    res.render('admin/dashboard', { user: req.session });
});

// ------------------------------------------
// Student Management
// ------------------------------------------
router.get('/students', adminOnly, async (req, res) => {
    try {
        const studentsQuery = await pool.query(
            `SELECT u.id, u.username, u.full_name, u.account_status, c.class_name, sp.parent_phone 
             FROM users u
             LEFT JOIN student_profiles sp ON u.id = sp.user_id
             LEFT JOIN classes c ON sp.class_id = c.id
             WHERE u.role = 'student' 
             ORDER BY u.username DESC`
        );
        const classesQuery = await pool.query('SELECT * FROM classes ORDER BY class_name ASC');

        res.render('admin/students', {
            user: req.session,
            students: studentsQuery.rows,
            classes: classesQuery.rows,
            success: req.query.success || null
        });
    } catch (err) {
        console.error("ADMIN STUDENT VIEW FAULT:", err);
        res.status(500).send('Database Error on Student Lookup');
    }
});

router.post('/students/create', adminOnly, validate({
    fullName: { required: true, minLength: 2, maxLength: 100 },
    className: { required: true },
    parentPhone: { required: true, pattern: /^[0-9+\-\s()]{7,20}$/ },
    customPassword: { required: true, minLength: 6 }
}), async (req, res) => {
    const { fullName, className, parentPhone, customPassword } = req.body;

    try {
        const countQuery = await pool.query("SELECT COUNT(*) FROM users WHERE role = 'student'");
        const sequence = String(parseInt(countQuery.rows[0].count) + 1).padStart(3, '0');
        const generatedStudentId = `HLT26${sequence}`;

        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(customPassword, saltRounds);

        const newUser = await pool.query(
            'INSERT INTO users (username, full_name, password_hash, role, account_status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [generatedStudentId, fullName, hashedPassword, 'student', 'active']
        );

        const newUserId = newUser.rows[0].id;

        await pool.query(
            'INSERT INTO student_profiles (user_id, class_id, parent_phone) VALUES ($1, $2, $3)',
            [newUserId, className, parentPhone]
        );

        const studentsQuery = await pool.query(
            `SELECT u.id, u.username, u.full_name, u.account_status, c.class_name, sp.parent_phone 
             FROM users u 
             LEFT JOIN student_profiles sp ON u.id = sp.user_id
             LEFT JOIN classes c ON sp.class_id = c.id
             WHERE u.role = 'student' ORDER BY u.username DESC`
        );
        const classesQuery = await pool.query('SELECT * FROM classes ORDER BY class_name ASC');

        res.render('admin/students', {
            user: req.session,
            students: studentsQuery.rows,
            classes: classesQuery.rows,
            success: `Successfully Registered: ${fullName} assigned Token ID: ${generatedStudentId}`
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Transaction rolled back: Student generation sequence encountered database faults.');
    }
});

router.post('/students/:id/toggle-freeze', adminOnly, async (req, res) => {
    const studentId = req.params.id;

    try {
        const userQuery = await pool.query(
            'SELECT id, username, full_name, account_status FROM users WHERE id = $1 AND role = $2',
            [studentId, 'student']
        );

        if (userQuery.rows.length === 0) {
            return res.status(404).send('Student not found.');
        }

        const user = userQuery.rows[0];
        const newStatus = user.account_status === 'frozen' ? 'active' : 'frozen';
        const action = newStatus === 'frozen' ? 'frozen' : 'unfrozen';

        await pool.query(
            'UPDATE users SET account_status = $1 WHERE id = $2',
            [newStatus, studentId]
        );

        console.log(`[ACCOUNT MANAGEMENT] Account ${action}: ${user.username} (${user.full_name})`);
        res.redirect(`/admin/students?success=${encodeURIComponent(`Student ${user.full_name} has been ${action}.`)}`);
    } catch (err) {
        console.error('[FREEZE ERROR]', err);
        res.status(500).send('Failed to update account status.');
    }
});

router.post('/students/:id/delete', adminOnly, async (req, res) => {
    const studentId = req.params.id;

    try {
        const userQuery = await pool.query(
            'SELECT id, username, full_name FROM users WHERE id = $1 AND role = $2',
            [studentId, 'student']
        );

        if (userQuery.rows.length === 0) {
            return res.status(404).send('Student not found.');
        }

        const user = userQuery.rows[0];

        await pool.query(
            `UPDATE users 
             SET account_status = 'deleted', 
                 deleted_at = CURRENT_TIMESTAMP,
                 username = CONCAT(username, '_deleted_', EXTRACT(EPOCH FROM NOW())::BIGINT)
             WHERE id = $1`,
            [studentId]
        );

        console.log(`[ACCOUNT MANAGEMENT] Account deleted: ${user.username} (${user.full_name})`);
        res.redirect(`/admin/students?success=${encodeURIComponent(`Student ${user.full_name} has been deleted.`)}`);
    } catch (err) {
        console.error('[DELETE ERROR]', err);
        res.status(500).send('Failed to delete account.');
    }
});

router.post('/students/:id/permanent-delete', adminOnly, async (req, res) => {
    const studentId = req.params.id;

    try {
        const userQuery = await pool.query(
            'SELECT id, username, full_name FROM users WHERE id = $1 AND role = $2',
            [studentId, 'student']
        );

        if (userQuery.rows.length === 0) {
            return res.status(404).send('Student not found.');
        }

        const user = userQuery.rows[0];

        await pool.query('DELETE FROM exam_attempts WHERE student_id = $1', [studentId]);
        await pool.query('DELETE FROM student_profiles WHERE user_id = $1', [studentId]);
        await pool.query('DELETE FROM users WHERE id = $1', [studentId]);

        console.log(`[ACCOUNT MANAGEMENT] Account permanently deleted: ${user.username}`);
        res.redirect(`/admin/students?success=${encodeURIComponent(`Student ${user.full_name} has been permanently deleted.`)}`);
    } catch (err) {
        console.error('[PERMANENT DELETE ERROR]', err);
        res.status(500).send('Failed to permanently delete account.');
    }
});

router.get('/students/:id/details', adminOnly, async (req, res) => {
    const studentId = req.params.id;

    try {
        const studentQuery = await pool.query(
            `SELECT u.*, sp.parent_phone, sp.class_id, c.class_name,
                    (SELECT COUNT(*) FROM exam_attempts WHERE student_id = u.id) as total_attempts,
                    (SELECT COALESCE(AVG(score_percentage), 0) FROM exam_attempts WHERE student_id = u.id) as avg_score
             FROM users u
             LEFT JOIN student_profiles sp ON u.id = sp.user_id
             LEFT JOIN classes c ON sp.class_id = c.id
             WHERE u.id = $1 AND u.role = 'student'`,
            [studentId]
        );

        if (studentQuery.rows.length === 0) {
            return res.status(404).send('Student not found.');
        }

        const student = studentQuery.rows[0];

        const attemptsQuery = await pool.query(
            `SELECT ea.*, e.title as exam_title
             FROM exam_attempts ea
             JOIN exams e ON ea.exam_id = e.id
             WHERE ea.student_id = $1
             ORDER BY ea.created_at DESC
             LIMIT 10`,
            [studentId]
        );

        res.render('admin/student_details', {
            user: req.session,
            student: student,
            attempts: attemptsQuery.rows
        });
    } catch (err) {
        console.error('[STUDENT DETAILS ERROR]', err);
        res.status(500).send('Failed to load student details.');
    }
});

// ------------------------------------------
// Curriculum
// ------------------------------------------
router.get('/curriculum', adminOnly, async (req, res) => {
    try {
        const lessonsQuery = await pool.query(
            `SELECT l.id, l.title, s.subject_name, c.class_name, l.video_url, l.document_url 
             FROM lessons l
             JOIN subjects s ON l.subject_id = s.id
             JOIN classes c ON l.class_id = c.id
             ORDER BY c.class_name ASC, s.subject_name ASC`
        );
        const subjectsQuery = await pool.query('SELECT * FROM subjects ORDER BY subject_name ASC');
        const classesQuery = await pool.query('SELECT * FROM classes ORDER BY class_name ASC');

        res.render('admin/curriculum', {
            user: req.session,
            lessons: lessonsQuery.rows,
            subjects: subjectsQuery.rows,
            classes: classesQuery.rows,
            success: null
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Curriculum engine initialization error.');
    }
});

router.post('/curriculum/lesson/create', upload.single('documentFile'), adminOnly, validate({
    title: { required: true, minLength: 3, maxLength: 200 },
    subjectId: { required: true },
    classId: { required: true }
}), async (req, res) => {
    if (!req.body || Object.keys(req.body).length === 0) {
        console.error("[CRITICAL] Express parsed an empty body stream.");
        return res.status(400).send("Form submission failed: Request body is empty.");
    }

    const { title, subjectId, classId, videoUrl } = req.body;

    if (!title || !subjectId || !classId) {
        return res.status(400).send("Form validation error: Missing Title, Subject, or Class Tier configuration.");
    }

    const documentUrl = req.file ? `/uploads/curriculum/${req.file.filename}` : null;

    try {
        await pool.query(
            'INSERT INTO lessons (title, subject_id, class_id, video_url, document_url) VALUES ($1, $2, $3, $4, $5)',
            [title, parseInt(subjectId), parseInt(classId), videoUrl || null, documentUrl]
        );
        res.redirect('/admin/curriculum');
    } catch (err) {
        console.error('[DATABASE FAULT]', err);
        res.status(500).send('File transaction database error: ' + err.message);
    }
});

router.post('/curriculum/lesson/edit/:id', adminOnly, validate({
    title: { required: true, minLength: 3, maxLength: 200 },
    subjectId: { required: true },
    classId: { required: true }
}), async (req, res) => {
    const lessonId = req.params.id;
    const { title, subjectId, classId, videoUrl } = req.body;
    try {
        await pool.query(
            `UPDATE lessons 
             SET title = $1, subject_id = $2, class_id = $3, video_url = $4 
             WHERE id = $5`,
            [title, parseInt(subjectId), parseInt(classId), videoUrl || null, parseInt(lessonId)]
        );
        res.redirect('/admin/curriculum');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to update the designated lesson matrix.');
    }
});

router.post('/curriculum/lesson/delete/:id', adminOnly, async (req, res) => {
    const lessonId = req.params.id;
    try {
        await pool.query('DELETE FROM lessons WHERE id = $1', [parseInt(lessonId)]);
        res.redirect('/admin/curriculum');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to purge the designated lesson matrix.');
    }
});

// ------------------------------------------
// Exams
// ------------------------------------------
router.get('/exams', adminOnly, async (req, res) => {
    try {
        const examsQuery = await pool.query(
            `SELECT 
                e.id, 
                e.title, 
                e.duration_minutes, 
                e.allowed_attempts,
                s.subject_name,
                c.class_name,
                (SELECT COUNT(*) FROM questions q WHERE q.exam_id = e.id) as question_count
             FROM exams e
             JOIN subjects s ON e.subject_id = s.id
             JOIN classes c ON e.class_id = c.id
             ORDER BY e.created_at DESC`
        );
        const subjectsQuery = await pool.query('SELECT * FROM subjects ORDER BY subject_name ASC');
        const classesQuery = await pool.query('SELECT * FROM classes ORDER BY class_name ASC');

        res.render('admin/exams', {
            user: req.session,
            exams: examsQuery.rows,
            subjects: subjectsQuery.rows,
            classes: classesQuery.rows,
            success: null
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('CBT engine compilation error.');
    }
});

router.post('/exams/create', adminOnly, validate({
    title: { required: true, minLength: 3, maxLength: 200 },
    subjectId: { required: true },
    classId: { required: true },
    durationMinutes: { required: true }
}), async (req, res) => {
    const { title, subjectId, classId, durationMinutes } = req.body;
    try {
        await pool.query(
            'INSERT INTO exams (title, subject_id, class_id, duration_minutes) VALUES ($1, $2, $3, $4)',
            [title, parseInt(subjectId), parseInt(classId), parseInt(durationMinutes)]
        );
        res.redirect('/admin/exams');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to initialize CBT exam module configuration.');
    }
});

router.post('/exams/:id/alter-attempts', adminOnly, validate({
    allowedAttempts: { required: true }
}), async (req, res) => {
    const examId = req.params.id;
    const { allowedAttempts } = req.body;

    try {
        await pool.query(
            'UPDATE exams SET allowed_attempts = $1 WHERE id = $2',
            [parseInt(allowedAttempts) || 1, parseInt(examId)]
        );
        res.redirect('/admin/exams');
    } catch (err) {
        console.error("EXAM ATTEMPT CORRECTION ERROR:", err);
        res.status(500).send('Failed to alter threshold constraints on target node.');
    }
});

router.get('/exams/:id/questions', adminOnly, async (req, res) => {
    const examId = req.params.id;
    try {
        const examQuery = await pool.query('SELECT * FROM exams WHERE id = $1', [examId]);
        const questionsQuery = await pool.query('SELECT * FROM questions WHERE exam_id = $1 ORDER BY id ASC', [examId]);

        if (examQuery.rows.length === 0) return res.status(404).send('Exam not found.');

        res.render('admin/questions', {
            user: req.session,
            exam: examQuery.rows[0],
            questions: questionsQuery.rows,
            success: req.query.success || null
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error loading question bank engine.');
    }
});

router.post('/exams/:id/questions/add', adminOnly, validate({
    questionText: { required: true, minLength: 10, maxLength: 2000 },
    optionA: { required: true },
    optionB: { required: true },
    optionC: { required: true },
    optionD: { required: true },
    correctOption: { required: true, oneOf: ['A', 'B', 'C', 'D'] }
}), async (req, res) => {
    const examId = req.params.id;
    const { questionText, optionA, optionB, optionC, optionD, correctOption } = req.body;

    if (!questionText || !optionA || !optionB || !optionC || !optionD || !correctOption) {
        return res.status(400).send('All fields are required including the correct option selection.');
    }

    const validOptions = ['A', 'B', 'C', 'D'];
    const cleanCorrectOption = String(correctOption).trim().toUpperCase();

    if (!validOptions.includes(cleanCorrectOption)) {
        return res.status(400).send(`Invalid correct option: "${correctOption}". Must be A, B, C, or D.`);
    }

    try {
        await pool.query(
            `INSERT INTO questions (exam_id, question_text, option_a, option_b, option_c, option_d, correct_option) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [parseInt(examId), questionText, optionA, optionB, optionC, optionD, cleanCorrectOption]
        );
        res.redirect(`/admin/exams/${examId}/questions?success=Question added successfully`);
    } catch (err) {
        console.error('[ADD QUESTION ERROR]', err);
        res.status(500).send('Failed to compile question entry matrix: ' + err.message);
    }
});

router.post('/exams/:examId/questions/edit/:questionId', adminOnly, validate({
    questionText: { required: true, minLength: 10, maxLength: 2000 },
    optionA: { required: true },
    optionB: { required: true },
    optionC: { required: true },
    optionD: { required: true },
    correctOption: { required: true, oneOf: ['A', 'B', 'C', 'D'] }
}), async (req, res) => {
    const { examId, questionId } = req.params;
    const { questionText, optionA, optionB, optionC, optionD, correctOption } = req.body;

    if (!questionText || !optionA || !optionB || !optionC || !optionD || !correctOption) {
        return res.status(400).send('All fields are required including the correct option selection.');
    }

    const validOptions = ['A', 'B', 'C', 'D'];
    const cleanCorrectOption = String(correctOption).trim().toUpperCase();

    if (!validOptions.includes(cleanCorrectOption)) {
        return res.status(400).send(`Invalid correct option: "${correctOption}". Must be A, B, C, or D.`);
    }

    try {
        await pool.query(
            `UPDATE questions 
             SET question_text = $1, option_a = $2, option_b = $3, option_c = $4, option_d = $5, correct_option = $6 
             WHERE id = $7 AND exam_id = $8`,
            [questionText, optionA, optionB, optionC, optionD, cleanCorrectOption, parseInt(questionId), parseInt(examId)]
        );
        res.redirect(`/admin/exams/${examId}/questions?success=Question updated successfully`);
    } catch (err) {
        console.error('[UPDATE QUESTION ERROR]', err);
        res.status(500).send('Failed to update the designated question matrix: ' + err.message);
    }
});

router.post('/exams/:examId/questions/delete/:questionId', adminOnly, async (req, res) => {
    const { examId, questionId } = req.params;
    try {
        await pool.query('DELETE FROM questions WHERE id = $1 AND exam_id = $2', [parseInt(questionId), parseInt(examId)]);
        res.redirect(`/admin/exams/${examId}/questions?success=Question deleted successfully`);
    } catch (err) {
        console.error('[DELETE QUESTION ERROR]', err);
        res.status(500).send('Failed to purge the designated question matrix.');
    }
});

// ------------------------------------------
// Results
// ------------------------------------------
router.get('/result', adminOnly, async (req, res) => {
    try {
        const statsQuery = await pool.query(`
            SELECT 
                COUNT(*)::INT as total_submissions,
                COALESCE(AVG(score_percentage), 0)::NUMERIC(5,1) as average_score,
                COUNT(CASE WHEN score_percentage >= 50 THEN 1 END)::INT as pass_count
            FROM exam_attempts
        `);

        const resultsQuery = await pool.query(`
            SELECT 
                ea.id,
                u.full_name as student_name,
                u.username as student_email,
                e.title as exam_title,
                ea.score_percentage as percentage,
                TO_CHAR(ea.created_at, 'YYYY-MM-DD HH24:MI:SS') as submission_date,
                COALESCE(ea.correct_answers_count, 0) as score_obtained,
                COALESCE(ea.total_questions_count, 0) as total_questions
            FROM exam_attempts ea
            JOIN users u ON ea.student_id = u.id
            JOIN exams e ON ea.exam_id = e.id
            ORDER BY ea.created_at DESC
        `);

        res.render('admin/result', {
            user: req.session,
            stats: statsQuery.rows[0],
            results: resultsQuery.rows
        });
    } catch (error) {
        console.error("RESULTS MATRIX PROCESSING ERROR:", error);
        res.status(500).send("Internal Server Error Matrix Failure");
    }
});

// ------------------------------------------
// Diagnostics
// ------------------------------------------
router.get('/diagnostic/exam-health', adminOnly, async (req, res) => {
    try {
        const examsQuery = await pool.query(
            `SELECT e.id, e.title, s.subject_name, c.class_name 
             FROM exams e
             JOIN subjects s ON e.subject_id = s.id
             JOIN classes c ON e.class_id = c.id
             ORDER BY e.created_at DESC`
        );

        const allQuestionsQuery = await pool.query(
            `SELECT q.*, e.title as exam_title 
             FROM questions q
             JOIN exams e ON q.exam_id = e.id
             ORDER BY e.id ASC, q.id ASC`
        );

        const exams = examsQuery.rows.map(exam => {
            const questions = allQuestionsQuery.rows.filter(q => q.exam_id === exam.id);
            const broken = questions.filter(q => !q.correct_option || !['A','B','C','D'].includes(q.correct_option));
            return {
                ...exam,
                questions,
                totalQuestions: questions.length,
                brokenCount: broken.length,
                validCount: questions.length - broken.length
            };
        });

        const totalQuestions = allQuestionsQuery.rows.length;
        const totalBroken = allQuestionsQuery.rows.filter(q => !q.correct_option || !['A','B','C','D'].includes(q.correct_option)).length;

        res.render('admin/exam_health', {
            user: req.session,
            exams,
            totalQuestions,
            totalBroken,
            totalValid: totalQuestions - totalBroken,
            success: req.query.success || null,
            error: req.query.error || null
        });
    } catch (err) {
        console.error('[DIAGNOSTIC ERROR]', err);
        res.status(500).send('Failed to load diagnostic engine: ' + err.message);
    }
});

router.post('/diagnostic/fix-correct-option', adminOnly, validate({
    questionId: { required: true },
    newCorrectOption: { required: true, oneOf: ['A', 'B', 'C', 'D'] }
}), async (req, res) => {
    const { questionId, newCorrectOption, examId } = req.body;

    const validOptions = ['A', 'B', 'C', 'D'];
    const cleanOption = String(newCorrectOption).trim().toUpperCase();

    if (!questionId || !validOptions.includes(cleanOption)) {
        return res.redirect('/admin/diagnostic/exam-health?error=Invalid question ID or option value.');
    }

    try {
        await pool.query(
            'UPDATE questions SET correct_option = $1 WHERE id = $2',
            [cleanOption, parseInt(questionId)]
        );
        console.log(`[REPAIR] Question #${questionId} correct_option updated to "${cleanOption}"`);
        res.redirect(`/admin/diagnostic/exam-health?success=Question #${questionId} fixed - correct option set to ${cleanOption}`);
    } catch (err) {
        console.error('[REPAIR ERROR]', err);
        res.redirect('/admin/diagnostic/exam-health?error=Failed to update question: ' + err.message);
    }
});

module.exports = router;
