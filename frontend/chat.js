const socket = new WebSocket("wss://chat-project-2.onrender.com/ws");

socket.onopen = function () {
  console.log("Connected to chat server!");
};

socket.onmessage = function (event) {
  const message = document.createElement("p");
  message.textContent = event.data;
  document.getElementById("chat-box").appendChild(message);
};

document.getElementById("send-btn").addEventListener("click", function () {
  const message = document.getElementById("message-input").value;
  socket.send(message);
});
 
