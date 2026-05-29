// Test script to verify theme saving functionality
const fetch = require('node-fetch');

async function testThemeSave() {
  try {
    console.log('Starting theme save test...');
    
    // Test 1: Get current theme API
    console.log('\n1. Testing theme API endpoint...');
    const themeResponse = await fetch('http://localhost:3000/api/theme?name=light');
    const themeVars = await themeResponse.text();
    console.log('Theme API response:', themeVars);
    
    // Test 2: Try to save theme (this will fail without authentication)
    console.log('\n2. Testing theme save (will fail without auth)...');
    const saveResponse = await fetch('http://localhost:3000/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: 'theme=light'
    });
    console.log('Save response status:', saveResponse.status);
    const saveText = await saveResponse.text();
    console.log('Save response text:', saveText);
    
    console.log('\nTest completed.');
  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Run the test if this script is executed directly
if (require.main === module) {
  testThemeSave();
}