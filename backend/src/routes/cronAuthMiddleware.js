module.exports = (req, res, next) => {
  const cronSecret = process.env.CRON_SECRET;
  const headerSecret = req.get('x-cron-secret');

  if (!cronSecret) {
    console.warn('CRON_SECRET is not configured.');
    return res.status(500).json({ message: '서버가 올바르게 구성되지 않았습니다.' });
  }

  if (!headerSecret || headerSecret !== cronSecret) {
    return res.status(401).json({ message: '인증되지 않은 요청입니다.' });
  }

  next();
};


