const io = require('socket.io-client');
const socket = io('http://localhost:3000');

socket.on('connect', () => {
    console.log('Connected!');
    socket.emit('arena:debug:gift', { giftName: 'Rosa', diamondCount: 1, uniqueId: 'test_player_123', nickname: 'Test Player' });
});

socket.on('arena:sync', (data) => {
    console.log('SYNC RECEIVED:', JSON.stringify(data, null, 2));
    process.exit(0);
});

socket.on('arena:join', (data) => {
    console.log('JOIN RECEIVED:', JSON.stringify(data, null, 2));
});

setTimeout(() => {
    console.log('Timeout');
    process.exit(1);
}, 3000);
