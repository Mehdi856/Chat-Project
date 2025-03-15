// Enhanced Authentication JavaScript
document.addEventListener('DOMContentLoaded', function() {
  if (document.getElementById('container')) {
    setupLoginPage();
  }
  
  // Handle logout button if it exists
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', logout);
  }
});

function setupLoginPage() {
  const signUpButton = document.getElementById('signUp');
  const signInButton = document.getElementById('signIn');
  const container = document.getElementById('container');
  const welcomeContent = document.querySelector('.welcome-content');
  const signupContent = document.querySelector('.signup-content');
  
  // Setup form submission handlers
  const signinForm = document.getElementById('signin-form');
  const signupForm = document.getElementById('signup-form');
  
  // Add input validation with visual feedback
  const allInputs = document.querySelectorAll('input');
  allInputs.forEach(input => {
    input.addEventListener('blur', function() {
      if (this.value.trim() !== '') {
        this.classList.add('valid');
      } else {
        this.classList.remove('valid');
      }
    });
  });
  
  if (signinForm) {
    signinForm.addEventListener('submit', function(e) {
      e.preventDefault();
      const email = document.getElementById('signin-email').value;
      const password = document.getElementById('signin-password').value;
      
      // Form validation
      if (!email || !password) {
        showMessage('Please fill in all fields', 'error');
        return;
      }
      
      // Add loading state
      const submitBtn = this.querySelector('button[type="submit"]');
      submitBtn.innerHTML = 'Signing In...';
      submitBtn.disabled = true;
      
      // Simulate network delay
      setTimeout(() => {
        // Simulate authentication
        mockSignIn(email, password);
      }, 800);
    });
  }
  
  if (signupForm) {
    signupForm.addEventListener('submit', function(e) {
      e.preventDefault();
      const name = document.getElementById('signup-name').value;
      const email = document.getElementById('signup-email').value;
      const password = document.getElementById('signup-password').value;
      
      // Form validation
      if (!name || !email || !password) {
        showMessage('Please fill in all fields', 'error');
        return;
      }
      
      if (password.length < 6) {
        showMessage('Password must be at least 6 characters', 'error');
        return;
      }
      
      // Add loading state
      const submitBtn = this.querySelector('button[type="submit"]');
      submitBtn.innerHTML = 'Creating Account...';
      submitBtn.disabled = true;
      
      // Simulate network delay
      setTimeout(() => {
        // Simulate registration
        mockSignUp(name, email, password);
      }, 1000);
    });
  }

  // Handle transition between sign-in and sign-up with improved animations
  if (signUpButton) {
    signUpButton.addEventListener('click', (e) => {
      e.preventDefault(); // Prevent default anchor behavior
      
      // Add mobile responsive class first
      if (window.innerWidth <= 768) {
        container.classList.add('mobile-transition');
      }
      
      // Fade out welcome content
      welcomeContent.style.opacity = 0;
      
      // After fade out, show signup content and fade it in
      setTimeout(() => {
        welcomeContent.style.display = 'none';
        signupContent.style.display = 'flex';
        
        // Trigger reflow
        void signupContent.offsetWidth;
        
        signupContent.classList.add('fade-in');
        signupContent.classList.add('col');
        signupContent.style.opacity = 1;
      }, 300);
      
      container.classList.add('right-panel-active');
    });
  }

  if (signInButton) {
    signInButton.addEventListener('click', (e) => {
      e.preventDefault(); // Prevent default anchor behavior
      
      // Fade out signup content
      signupContent.style.opacity = 0;
      
      // After fade out, show welcome content and fade it in
      setTimeout(() => {
        signupContent.style.display = 'none';
        welcomeContent.style.display = 'flex';
        
        // Trigger reflow
        void welcomeContent.offsetWidth;
        
        welcomeContent.classList.add('fade-in');
        welcomeContent.classList.add('col');
        welcomeContent.style.opacity = 1;
      }, 300);
      
      container.classList.remove('right-panel-active');
      
      // Remove mobile transition class after animation completes
      if (window.innerWidth <= 768) {
        setTimeout(() => {
          container.classList.remove('mobile-transition');
        }, 800);
      }
    });
  }
}

// Create a message display function
function showMessage(message, type = 'info') {
  // Check if message container exists, if not create it
  let messageContainer = document.querySelector('.message-container');
  if (!messageContainer) {
    messageContainer = document.createElement('div');
    messageContainer.className = 'message-container';
    document.body.appendChild(messageContainer);
  }
  
  const messageElement = document.createElement('div');
  messageElement.className = `message ${type}`;
  messageElement.textContent = message;
  
  messageContainer.appendChild(messageElement);
  
  // Auto remove after 3 seconds
  setTimeout(() => {
    messageElement.classList.add('fade-out');
    setTimeout(() => {
      messageElement.remove();
      // Remove container if empty
      if (messageContainer.children.length === 0) {
        messageContainer.remove();
      }
    }, 300);
  }, 3000);
}

function mockSignIn(email, password) {
  // Check if user exists in localStorage (simple validation)
  const users = JSON.parse(localStorage.getItem('users') || '[]');
  const userExists = users.some(user => user.email === email);
  
  if (!userExists) {
    // In a real app, you would validate password here too
    // For now, we'll create account if it doesn't exist
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    users.push({name: 'User', email: email});
    localStorage.setItem('users', JSON.stringify(users));
  }
  
  // Store in session to simulate login
  sessionStorage.setItem('currentUser', JSON.stringify({email: email}));
  
  // Redirect to main page
  window.location.href = 'index.html';
}

function mockSignUp(name, email, password) {
  // Store in local storage to simulate user registration
  const users = JSON.parse(localStorage.getItem('users') || '[]');
  
  // Check if user already exists
  if (users.some(user => user.email === email)) {
    showMessage('User already exists with this email', 'error');
    
    // Reset button state
    const submitBtn = document.querySelector('#signup-form button[type="submit"]');
    submitBtn.innerHTML = 'Sign Up';
    submitBtn.disabled = false;
    return;
  }
  
  users.push({name: name, email: email});
  localStorage.setItem('users', JSON.stringify(users));
  
  // Show success message then auto login
  showMessage('Account created successfully!', 'success');
  
  setTimeout(() => {
    // Auto login after signup
    mockSignIn(email, password);
  }, 1000);
}

// Function to check if user is logged in
function isLoggedIn() {
  return sessionStorage.getItem('currentUser') !== null;
}

// Function to log out
function logout() {
  sessionStorage.removeItem('currentUser');
  window.location.href = 'login.html';
}

// Handle window resize for responsive layout
window.addEventListener('resize', function() {
  const container = document.getElementById('container');
  if (container) {
    if (window.innerWidth <= 768) {
      container.classList.add('mobile-view');
    } else {
      container.classList.remove('mobile-view');
    }
  }
});

// Initial check for mobile view
document.addEventListener('DOMContentLoaded', function() {
  const container = document.getElementById('container');
  if (container && window.innerWidth <= 768) {
    container.classList.add('mobile-view');
  }
});
