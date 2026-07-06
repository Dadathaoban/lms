// ==========================================
// 1. DEPENDENCY ACQUISITIONS & INFRASTRUCTURE
// ==========================================
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const app = express();

// Neon PostgreSQL Database Pool Connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Ensure directory path maps exist locally to prevent disk write crashes
const uploadDir = path.join(__dirname, 'public', 'uploads', 'curriculum');
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir, { recursive: true });
}

// ==========================================
// 2. FILE PROCESSING SUBSYSTEMS (MULTER)
// ==========================================
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/uploads/curriculum/'); 
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname)); 
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 15 * 1024 * 1024 } // 15MB Upstream Limit
});

// ==========================================
// 3. MIDDLEWARE CONFIGURATIONS & PIPELINES
// ==========================================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));
app.set('view engine', 'ejs');

app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback_cybersecurity_system_key_2026',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        maxAge: 24 * 60 * 60 * 1000, // 1 Day
        secure: false 
    }
}));

// ==========================================
// 4. ROUTE GUARD PROTECTION FILTERS
// ==========================================
const redirectIfLoggedIn = (req, res, next) => {
    if (req.session.userId) {
        return res.redirect(req.session.role === 'admin' ? '/admin/dashboard' : '/student/dashboard');
    }
    next();
};

// ✅ SINGLE DEFINITION - Enhanced with account status check
const protectRoute = (role) => {
    return async (req, res, next) => {
        if (!req.session.userId || req.session.role !== role) {
            return res.redirect('/login');
        }
        
        // Check if account is still active
        try {
            const userQuery = await pool.query(
                'SELECT account_status FROM users WHERE id = $1',
                [req.session.userId]
            );
            
            if (userQuery.rows.length === 0) {
                req.session.destroy();
                return res.redirect('/login?error=Account not found');
            }
            
            const status = userQuery.rows[0].account_status;
            
            if (status === 'frozen') {
                req.session.destroy();
                return res.redirect('/login?error=Your account has been frozen. Contact your administrator.');
            }
            
            if (status === 'deleted') {
                req.session.destroy();
                return res.redirect('/login?error=Your account has been deactivated.');
            }
            
            next();
        } catch (err) {
            console.error('[ROUTE GUARD ERROR]', err);
            return res.redirect('/login?error=System error');
        }
    };
};

// ==========================================
// 5. CORE ROUTING CONTROLLER MATRIX
// ==========================================

// TEMPORARY ROUTE TO RE-SEED THE ADMIN ACCOUNT PERFECTLY
app.get('/setup-admin', async (req, res) => {
    try {
        await pool.query('DELETE FROM users WHERE username = $1', ['admin']);
        
        const plainTextPassword = 'admin1234';
        const saltRounds = 10;
        const freshHash = await bcrypt.hash(plainTextPassword, saltRounds);
        
        await pool.query(
            'INSERT INTO users (username, full_name, password_hash, role, account_status) VALUES ($1, $2, $3, $4, $5)',
            ['admin', 'Main Administrator', freshHash, 'admin', 'active']
        );
        
        res.send('<h1>Admin account re-seeded successfully!</h1><p>Login: admin / admin1234</p>');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error resetting admin account: ' + err.message);
    }
});

// Public Landing Page
app.get('/', (req, res) => {
    res.render('public/index'); 
});

// Portal Login Page (GET)
app.get('/login', redirectIfLoggedIn, (req, res) => {
    res.render('auth/login', { error: null });
});

// Secure Authentication Engine (POST)
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    console.log(`[AUTH LOG] Login attempt for User ID: ${username}`);
    
    try {
        const userQuery = await pool.query(
            'SELECT * FROM users WHERE username = $1 AND deleted_at IS NULL',
            [username]
        );
        
        if (userQuery.rows.length === 0) {
            console.log(`[AUTH LOG] User ID "${username}" not found in database.`);
            return res.render('auth/login', { error: 'Invalid User ID or Password.' });
        }

        const user = userQuery.rows[0];
        console.log(`[AUTH LOG] User found. Status: ${user.account_status}, Role: ${user.role}`);

        // Check if account is frozen
        if (user.account_status === 'frozen') {
            console.log(`[AUTH LOG] Frozen account attempt: ${username}`);
            return res.render('auth/login', { 
                error: 'Your account has been frozen. Please contact your administrator.' 
            });
        }

        // Check if account is deleted
        if (user.account_status === 'deleted') {
            console.log(`[AUTH LOG] Deleted account attempt: ${username}`);
            return res.render('auth/login', { 
                error: 'Your account has been deactivated. Please contact your administrator.' 
            });
        }

        const isMatch = await bcrypt.compare(password, user.password_hash);
        console.log(`[AUTH LOG] Password match result: ${isMatch}`);

        if (!isMatch) {
            return res.render('auth/login', { error: 'Invalid User ID or Password.' });
        }

        // Update last login timestamp
        await pool.query(
            'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
            [user.id]
        );

        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.fullName = user.full_name;
        req.session.role = user.role;

        res.redirect(user.role === 'admin' ? '/admin/dashboard' : '/student/dashboard');
    } catch (err) {
        console.error('[AUTH ERROR]', err);
        res.status(500).send('Internal System Error');
    }
});

// ------------------------------------------
// ADMIN WORKSPACE CONTROLLERS
// ------------------------------------------

// Admin Dashboard Land Route
app.get('/admin/dashboard', protectRoute('admin'), (req, res) => {
    res.render('admin/dashboard', { user: req.session });
});

// GET: Admin Student Management View
app.get('/admin/students', protectRoute('admin'), async (req, res) => {
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

// POST: Register New Student Instance
app.post('/admin/students/create', protectRoute('admin'), async (req, res) => {
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

// ==========================================
// STUDENT ACCOUNT MANAGEMENT ROUTES
// ==========================================

// POST: Freeze/Unfreeze Student Account
app.post('/admin/students/:id/toggle-freeze', protectRoute('admin'), async (req, res) => {
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

// POST: Soft Delete Student Account
app.post('/admin/students/:id/delete', protectRoute('admin'), async (req, res) => {
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

// POST: Permanently Delete Student Account
app.post('/admin/students/:id/permanent-delete', protectRoute('admin'), async (req, res) => {
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

// GET: View Student Details
app.get('/admin/students/:id/details', protectRoute('admin'), async (req, res) => {
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

// GET: Admin Curriculum Panel
app.get('/admin/curriculum', protectRoute('admin'), async (req, res) => {
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

// POST: Create and Commit New Lesson Node with Document Upload
app.post('/admin/curriculum/lesson/create', upload.single('documentFile'), protectRoute('admin'), async (req, res) => {
    if (!req.body || Object.keys(req.body).length === 0) {
        console.error("[CRITICAL] Express parsed an empty body stream.");
        return res.status(400).send("Form submission failed: Request body is empty.");
    }

    const { title, subjectId, classId, videoUrl } = req.body;
    
    console.log('[CURRICULUM FLOW] Incoming Form Text Fields:', req.body);
    console.log('[CURRICULUM FLOW] Incoming Parsed Binary File:', req.file);

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

// POST: Update an Existing Lesson Node
app.post('/admin/curriculum/lesson/edit/:id', protectRoute('admin'), async (req, res) => {
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

// POST: Purge a Lesson Node completely
app.post('/admin/curriculum/lesson/delete/:id', protectRoute('admin'), async (req, res) => {
    const lessonId = req.params.id;
    try {
        await pool.query('DELETE FROM lessons WHERE id = $1', [parseInt(lessonId)]);
        res.redirect('/admin/curriculum');
    } catch (err) {
        console.error(err);
        res.status(500).send('Failed to purge the designated lesson matrix.');
    }
});

// ==========================================
// ADMIN EXAMS WORKSPACE
// ==========================================

// GET: Admin Exams Workspace Terminal
app.get('/admin/exams', protectRoute('admin'), async (req, res) => {
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

// POST: Build and Commit New Exam Profile
app.post('/admin/exams/create', protectRoute('admin'), async (req, res) => {
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

// POST: Alter Exam Metrics & Max Retakes Threshold Allocation
app.post('/admin/exams/:id/alter-attempts', protectRoute('admin'), async (req, res) => {
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

// GET: Manage Exam Questions Bank
app.get('/admin/exams/:id/questions', protectRoute('admin'), async (req, res) => {
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

// POST: Add Question Entry to Bank Matrix (WITH VALIDATION)
app.post('/admin/exams/:id/questions/add', protectRoute('admin'), async (req, res) => {
    const examId = req.params.id;
    const { questionText, optionA, optionB, optionC, optionD, correctOption } = req.body;
    
    if (!questionText || !optionA || !optionB || !optionC || !optionD || !correctOption) {
        return res.status(400).send('❌ All fields are required including the correct option selection.');
    }
    
    const validOptions = ['A', 'B', 'C', 'D'];
    const cleanCorrectOption = String(correctOption).trim().toUpperCase();
    
    if (!validOptions.includes(cleanCorrectOption)) {
        return res.status(400).send(`❌ Invalid correct option: "${correctOption}". Must be A, B, C, or D.`);
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

// POST: Update an Existing Question Entry Node (WITH VALIDATION)
app.post('/admin/exams/:examId/questions/edit/:questionId', protectRoute('admin'), async (req, res) => {
    const { examId, questionId } = req.params;
    const { questionText, optionA, optionB, optionC, optionD, correctOption } = req.body;
    
    if (!questionText || !optionA || !optionB || !optionC || !optionD || !correctOption) {
        return res.status(400).send('❌ All fields are required including the correct option selection.');
    }
    
    const validOptions = ['A', 'B', 'C', 'D'];
    const cleanCorrectOption = String(correctOption).trim().toUpperCase();
    
    if (!validOptions.includes(cleanCorrectOption)) {
        return res.status(400).send(`❌ Invalid correct option: "${correctOption}". Must be A, B, C, or D.`);
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

// POST: Purge a Question Entry Node completely
app.post('/admin/exams/:examId/questions/delete/:questionId', protectRoute('admin'), async (req, res) => {
    const { examId, questionId } = req.params;
    try {
        await pool.query('DELETE FROM questions WHERE id = $1 AND exam_id = $2', [parseInt(questionId), parseInt(examId)]);
        res.redirect(`/admin/exams/${examId}/questions?success=Question deleted successfully`);
    } catch (err) {
        console.error('[DELETE QUESTION ERROR]', err);
        res.status(500).send('Failed to purge the designated question matrix.');
    }
});

// GET: Admin Performance / Results Matrix
app.get('/admin/result', protectRoute('admin'), async (req, res) => {
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
// STUDENT WORKSPACE CONTROLLERS
// ------------------------------------------

// GET: Student Workspace Terminal & CBT Exam Feed
app.get('/student/dashboard', protectRoute('student'), async (req, res) => {
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

// GET: Student Private Performance Records
app.get('/student/results', protectRoute('student'), async (req, res) => {
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

// GET: Render Active CBT Examination Environment
app.get('/student/exams/:id', protectRoute('student'), async (req, res) => {
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
                    <h2 style="color: #dc3545;">⚠ Access Denied</h2>
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

// POST: Process, Score, and Commit CBT Exam Script
// POST: Process, Score, and Commit CBT Exam Script (FULLY WORKING)
app.post('/student/exams/:id/submit', async (req, res) => {
    const examId = req.params.id;
    const studentId = req.session.userId; // Adjust to match your session variable

    let submittedAnswers = {};

    // Standard express parser structure for nested object patterns
    if (req.body.answers && typeof req.body.answers === 'object' && !Array.isArray(req.body.answers)) {
        submittedAnswers = req.body.answers;
    } 
    
    // Explicit browser-serialized string catcher fallback for "answers[id]" fields
    Object.keys(req.body).forEach(key => {
        if (key.startsWith('answers[')) {
            const cleanId = key.replace('answers[', '').replace(']', '');
            submittedAnswers[cleanId] = req.body[key];
        }
    });

    try {
        // Query questions linked to this examination profile
        const questionsQuery = await pool.query(
            'SELECT id, correct_option FROM questions WHERE exam_id = $1 ORDER BY id ASC',
            [examId]
        );
        
        const totalQuestions = questionsQuery.rows.length;
        if (totalQuestions === 0) {
            return res.status(400).send('Evaluation error: No questions active inside this exam profile.');
        }

        let correctCount = 0;
        const detailedResults = []; // Matched matrix passed down into the EJS rendering module

        questionsQuery.rows.forEach((q, index) => {
            const rawStudentAnswer = submittedAnswers[q.id];
            
            // Clean up white spaces and equalize uppercase standard notation strings
            const correctAnswer = String(q.correct_option).trim().toUpperCase();
            const studentAnswer = rawStudentAnswer ? String(rawStudentAnswer).trim().toUpperCase() : '';
            
            const isCorrect = studentAnswer === correctAnswer;
            if (isCorrect) {
                correctCount++;
            }

            // Push precise naming conventions matching view object fields
            detailedResults.push({
                questionNumber: index + 1,
                studentAnswer: studentAnswer || '(no answer)',
                correctAnswer: correctAnswer,
                isCorrect: isCorrect
            });
        });

        const scorePercentage = (correctCount / totalQuestions) * 100;

        // Commit script history stats block to database log
        await pool.query(
            `INSERT INTO exam_attempts 
             (student_id, exam_id, score_percentage, correct_answers_count, total_questions_count) 
             VALUES ($1, $2, $3, $4, $5)`,
            [studentId, examId, parseFloat(scorePercentage.toFixed(2)), correctCount, totalQuestions]
        );

        // Fetch Exam Title profile parameters
        const examQuery = await pool.query('SELECT title FROM exams WHERE id = $1', [examId]);
        const examTitle = examQuery.rows[0]?.title || 'Assessment Component';

        // Render response page and transmit payload variables matching EJS layout expectations
        res.render('student/exam_result', {
            examTitle: examTitle,
            scorePercentage: parseFloat(scorePercentage.toFixed(2)),
            correctCount: correctCount,
            totalQuestions: totalQuestions,
            detailedResults: detailedResults // Critical link
        });

    } catch (err) {
        console.error('[CRITICAL SELECTION PARSING TRACE ERROR]:', err);
        res.status(500).send('Failed to parse assessment submission logs.');
    }
});
// EMERGENCY DIAGNOSTIC ROUTE
app.get('/debug/full-trace/:examId', protectRoute('admin'), async (req, res) => {
    const examId = req.params.examId;
    
    try {
        const questions = await pool.query(
            'SELECT * FROM questions WHERE exam_id = $1 ORDER BY id',
            [examId]
        );
        
        const attempts = await pool.query(
            `SELECT ea.*, u.username 
             FROM exam_attempts ea 
             JOIN users u ON ea.student_id = u.id 
             WHERE ea.exam_id = $1 
             ORDER BY ea.created_at DESC 
             LIMIT 5`,
            [examId]
        );
        
        let html = `
        <html><head><style>
            body { font-family: monospace; padding: 20px; background: #000; color: #0f0; }
            table { border-collapse: collapse; width: 100%; margin: 20px 0; }
            th, td { border: 1px solid #0f0; padding: 8px; text-align: left; }
            .error { color: #f00; font-weight: bold; }
            .success { color: #0f0; }
        </style></head><body>
        <h1>🔬 FULL SYSTEM DIAGNOSTIC - EXAM ID: ${examId}</h1>
        <h2>Questions in Database:</h2>
        <table><tr><th>ID</th><th>Question</th><th>CORRECT_OPTION</th><th>Status</th></tr>`;
        
        questions.rows.forEach(q => {
            const status = !q.correct_option ? 'NULL ⚠️' : 
                          !['A','B','C','D'].includes(q.correct_option) ? 'INVALID ⚠️' : '✅ VALID';
            const color = status.includes('✅') ? 'success' : 'error';
            html += `<tr>
                <td>${q.id}</td>
                <td>${q.question_text?.substring(0, 50)}...</td>
                <td class="${color}"><strong>${q.correct_option || 'NULL'}</strong></td>
                <td class="${color}">${status}</td>
            </tr>`;
        });
        html += '</table></body></html>';
        res.send(html);
        
    } catch (err) {
        res.status(500).send('Diagnostic error: ' + err.message);
    }
});

// ==========================================
// EXAM HEALTH DIAGNOSTIC & REPAIR TOOL
// ==========================================

// GET: Full Diagnostic Page - Audit all questions across all exams
app.get('/admin/diagnostic/exam-health', protectRoute('admin'), async (req, res) => {
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

// POST: Fix a single question's correct_option
app.post('/admin/diagnostic/fix-correct-option', protectRoute('admin'), async (req, res) => {
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
        res.redirect(`/admin/diagnostic/exam-health?success=Question #${questionId} fixed → correct option set to ${cleanOption}`);
    } catch (err) {
        console.error('[REPAIR ERROR]', err);
        res.redirect('/admin/diagnostic/exam-health?error=Failed to update question: ' + err.message);
    }
});

// Secure Signout Endpoint
app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
});

// Initialize Express Engine Node Server Bound to Port 3000
app.listen(3000, () => {
    console.log('[SERVER REINITIALIZED] Live on http://localhost:3000');
});