function scoreExam(submittedAnswers, questions) {
    let correctCount = 0;
    const detailedResults = [];

    questions.forEach((q, index) => {
        const rawStudentAnswer = submittedAnswers[q.id];
        const correctAnswer = String(q.correct_option).trim().toUpperCase();
        const studentAnswer = rawStudentAnswer ? String(rawStudentAnswer).trim().toUpperCase() : '';
        const isCorrect = studentAnswer === correctAnswer;
        if (isCorrect) correctCount++;

        detailedResults.push({
            questionNumber: index + 1,
            studentAnswer: studentAnswer || '(no answer)',
            correctAnswer,
            isCorrect
        });
    });

    const totalQuestions = questions.length;
    const scorePercentage = totalQuestions > 0 ? (correctCount / totalQuestions) * 100 : 0;

    return {
        correctCount,
        totalQuestions,
        scorePercentage: parseFloat(scorePercentage.toFixed(2)),
        detailedResults
    };
}

describe('exam scoring logic', () => {
    const questions = [
        { id: 1, correct_option: 'A' },
        { id: 2, correct_option: 'B' },
        { id: 3, correct_option: 'C' },
        { id: 4, correct_option: 'D' }
    ];

    it('scores 100% when all answers are correct', () => {
        const answers = { 1: 'A', 2: 'B', 3: 'C', 4: 'D' };
        const result = scoreExam(answers, questions);
        expect(result.correctCount).toBe(4);
        expect(result.scorePercentage).toBe(100);
    });

    it('scores 0% when all answers are wrong', () => {
        const answers = { 1: 'B', 2: 'A', 3: 'D', 4: 'C' };
        const result = scoreExam(answers, questions);
        expect(result.correctCount).toBe(0);
        expect(result.scorePercentage).toBe(0);
    });

    it('scores 50% when 2 of 4 are correct', () => {
        const answers = { 1: 'A', 2: 'B', 3: 'X', 4: 'X' };
        const result = scoreExam(answers, questions);
        expect(result.correctCount).toBe(2);
        expect(result.scorePercentage).toBe(50);
    });

    it('handles missing answers as wrong', () => {
        const answers = { 1: 'A' };
        const result = scoreExam(answers, questions);
        expect(result.correctCount).toBe(1);
        expect(result.scorePercentage).toBe(25);
    });

    it('handles empty answers object', () => {
        const result = scoreExam({}, questions);
        expect(result.correctCount).toBe(0);
        expect(result.scorePercentage).toBe(0);
    });

    it('is case insensitive', () => {
        const answers = { 1: 'a', 2: 'b', 3: 'c', 4: 'd' };
        const result = scoreExam(answers, questions);
        expect(result.correctCount).toBe(4);
    });

    it('trims whitespace', () => {
        const answers = { 1: '  A  ', 2: ' B ', 3: '  C  ', 4: ' D ' };
        const result = scoreExam(answers, questions);
        expect(result.correctCount).toBe(4);
    });

    it('returns detailed results per question', () => {
        const answers = { 1: 'A', 2: 'X' };
        const result = scoreExam(answers, questions);
        expect(result.detailedResults).toHaveLength(4);
        expect(result.detailedResults[0]).toEqual({
            questionNumber: 1,
            studentAnswer: 'A',
            correctAnswer: 'A',
            isCorrect: true
        });
        expect(result.detailedResults[1]).toEqual({
            questionNumber: 2,
            studentAnswer: 'X',
            correctAnswer: 'B',
            isCorrect: false
        });
    });

    it('handles no questions gracefully', () => {
        const result = scoreExam({}, []);
        expect(result.correctCount).toBe(0);
        expect(result.totalQuestions).toBe(0);
        expect(result.scorePercentage).toBe(0);
    });
});
