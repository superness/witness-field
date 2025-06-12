import Gun from 'gun';

const gun = Gun({
  peers: ['https://the-witness-field-production.up.railway.app/gun'],
  localStorage: false,
  radisk: false
});

gun.on('hi', (peer) => console.log('🟢 Connected to:', peer.url || 'localStorage'));
gun.on('bye', (peer) => console.log('🔴 Disconnected from:', peer.url || 'peer'));

const fieldNode = gun.get('witness-field-collective-public-v3');
console.log('📡 Listening for witnesses in namespace: witness-field-collective-public-v3');

let witnessCount = 0;
fieldNode.map().on((data, key) => {
  if (data && data.text && !key.includes('-v')) {
    witnessCount++;
    console.log(`📝 Found witness ${witnessCount}:`, key, '"' + data.text.substring(0, 40) + '..."');
  }
});

setTimeout(() => {
  console.log(`\n📊 Total witnesses found: ${witnessCount}`);
  console.log('🏁 Test complete');
  process.exit(0);
}, 15000);