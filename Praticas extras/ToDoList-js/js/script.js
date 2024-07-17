// Seleção de elementos
const todoForm = document.querySelector('#todo-form');
const todoInput = document.querySelector('#todo-input');
const todoList = document.querySelector('#todo-list');
const editInput = document.querySelector('#edit-input');
const editForm = document.querySelector('#edit-form');
const cancelEditBtn = document.querySelector('#cancel-edit-btn');

let oldInputValue;

//Funções
const saveTodo = (text) => {
  const todo = document.createElement("div");
  todo.classList.add("todo");

  const todoTitle = document.createElement("h3");
  todoTitle.innerText = text;
  todo.appendChild(todoTitle);

  const doneBtn = document.createElement("button");
  doneBtn.classList.add("finish-todo");
  doneBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
  todo.appendChild(doneBtn);

  const editBtn = document.createElement("button");
  editBtn.classList.add("edit-todo");
  editBtn.innerHTML = '<i class="fa-solid fa-pen"></i>';
  todo.appendChild(editBtn);

  const deleteBtn = document.createElement("button");
  deleteBtn.classList.add("remove-todo");
  deleteBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
  todo.appendChild(deleteBtn);

  todoList.appendChild(todo);

  todoInput.value = "";
  todoInput.focus();
}

const toggleForms = () => {
  editForm.classList.toggle("hide");
  todoForm.classList.toggle("hide");
  todoList.classList.toggle("hide");
}

const updateTodo = (text) => {

  const todos = document.querySelectorAll('.todo');
  todos.forEach((todo) => {

    let todoTitle = todo.querySelector('h3');

    if(todoTitle.innerText === oldInputValue){
      todoTitle.innerText = text;
    }
  })
}

//Eventos
todoForm.addEventListener("submit", (e) => {
  e.preventDefault();

  const inputValue = todoInput.value

  if(inputValue) {
    saveTodo(inputValue)
    //save todo
  }
})

document.addEventListener("click", (e) => {
  const targetEl = e.target;
  const parentEl = targetEl.closest('div');
  let todoTitle;  //Pq criar aqui e não na linha 61? Ao declarar todoTitle no início da função de callback, ela é acessível a partir do ponto de declaração até o final da função de callback. Se fosse declarada dentro do bloco if, seu escopo estaria limitado a esse bloco específico.
  
  if(parentEl && parentEl.querySelector('h3')){
    todoTitle = parentEl.querySelector("h3").innerText;  //Atribui o texto do primeiro elemento <h3> encontrado dentro do elemento pai (<div>) à variável todoTitle, apenas se o elemento pai contiver um <h3>.
  }

  if(targetEl.classList.contains("finish-todo")){
    parentEl.classList.toggle("done");
  }

  if(targetEl.classList.contains("remove-todo")){
    parentEl.remove();
  }

  if(targetEl.classList.contains("edit-todo")){
    toggleForms();

    editInput.value = todoTitle;
    oldInputValue = todoTitle;
  }
 })

 cancelEditBtn.addEventListener("click", (e) => {
  e.preventDefault()

  toggleForms();
 });

 editForm.addEventListener("submit", (e) => {
  e.preventDefault()

  const editInputValue = editInput.value

  if(editInputValue) {
    //atualizar
    updateTodo(editInputValue);
  }
  toggleForms()
 });