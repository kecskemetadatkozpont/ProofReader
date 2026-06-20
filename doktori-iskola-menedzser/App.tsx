
import React, { useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { StudentList } from './components/StudentList';
import { StudentDetail } from './components/StudentDetail';
import { SupervisorList } from './components/SupervisorList';
import { AddStudentModal } from './components/AddStudentModal';
import { ProjectBoard } from './components/ProjectBoard';
import { INITIAL_STUDENTS, MOCK_SUPERVISORS } from './constants';
import { Student, ViewState, User, UserRole, Project } from './types';
import { Lock, User as UserIcon, LogIn } from 'lucide-react';

// Mock Initial Projects
const INITIAL_PROJECTS: Project[] = [
  {
    id: 'p1',
    title: 'Kvantum-rezisztens algoritmusok fejlesztése',
    description: 'A poszt-kvantum kriptográfia területén keresünk hallgatót új algoritmusok tesztelésére.',
    supervisorId: 's3',
    supervisorName: 'Dr. Horváth Júlia',
    tags: ['Cryptography', 'Quantum', 'Security'],
    status: 'OPEN',
    createdAt: '2025-01-15'
  },
  {
    id: 'p2',
    title: 'Smart City szenzorhálózatok szociológiai hatásai',
    description: 'Interdiszciplináris kutatás a városi lakosság technológia-elfogadásáról.',
    supervisorId: 's2',
    supervisorName: 'Prof. Dr. Kiss Elemér',
    tags: ['IoT', 'Sociology', 'Urban Planning'],
    status: 'OPEN',
    createdAt: '2025-02-01'
  }
];

function App() {
  // Auth State
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  // App Data State
  const [currentView, setCurrentView] = useState<ViewState>('DASHBOARD');
  const [students, setStudents] = useState<Student[]>(INITIAL_STUDENTS);
  const [projects, setProjects] = useState<Project[]>(INITIAL_PROJECTS);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // --- ACTIONS ---

  const handleLogin = (role: UserRole) => {
    let user: User;
    if (role === UserRole.ADMIN) {
      user = { id: 'admin1', name: 'Adminisztrátor', role: UserRole.ADMIN, avatarUrl: 'https://ui-avatars.com/api/?name=Admin&background=000&color=fff' };
      setCurrentView('DASHBOARD');
    } else if (role === UserRole.SUPERVISOR) {
      // Mock logging in as Dr. Nagy István (s1)
      const sup = MOCK_SUPERVISORS[0];
      user = { id: sup.id, name: sup.name, role: UserRole.SUPERVISOR, avatarUrl: sup.avatarUrl, linkedId: sup.id };
      setCurrentView('DASHBOARD');
    } else {
      // Mock logging in as Kovács Péter (1)
      const stud = students[0];
      user = { id: stud.id, name: stud.name, role: UserRole.STUDENT, avatarUrl: stud.avatarUrl, linkedId: stud.id };
      // Students go straight to their detail view
      setSelectedStudentId(stud.id);
      setCurrentView('STUDENT_DETAIL');
    }
    setCurrentUser(user);
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setCurrentView('DASHBOARD');
    setSelectedStudentId(null);
  };

  const handleSelectStudent = (student: Student) => {
    setSelectedStudentId(student.id);
    setCurrentView('STUDENT_DETAIL');
  };

  const handleAddStudent = (newStudent: Student) => {
    setStudents([...students, newStudent]);
    setIsAddModalOpen(false);
    setSelectedStudentId(newStudent.id);
    setCurrentView('STUDENT_DETAIL');
  };

  const handleUpdateStudent = (updatedStudent: Student) => {
    setStudents(students.map(s => s.id === updatedStudent.id ? updatedStudent : s));
  };

  const handleAddProject = (newProject: Project) => {
    setProjects([newProject, ...projects]);
  };

  // --- FILTERED DATA BASED ON ROLE ---

  const getVisibleStudents = () => {
    if (!currentUser) return [];
    if (currentUser.role === UserRole.ADMIN) return students;
    if (currentUser.role === UserRole.SUPERVISOR) {
      // Show students supervised by current user OR matches the name
      return students.filter(s => s.supervisor === currentUser.name || s.supervisorId === currentUser.linkedId);
    }
    // Students normally don't see the list, but if they do, maybe only themselves?
    return students.filter(s => s.id === currentUser.linkedId);
  };

  // --- RENDERERS ---

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center font-sans">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full">
          <div className="flex justify-center mb-6">
            <div className="p-4 bg-blue-600 rounded-full shadow-lg">
              <Lock className="text-white w-8 h-8" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-center text-slate-800 mb-2">Doktori Iskola Menedzser</h1>
          <p className="text-center text-slate-500 mb-8">Kérjük válasszon szerepkört a belépéshez (Demo)</p>
          
          <div className="space-y-3">
            <button onClick={() => handleLogin(UserRole.ADMIN)} className="w-full p-4 border border-slate-200 rounded-xl flex items-center gap-4 hover:bg-slate-50 hover:border-blue-500 transition-all group">
               <div className="w-10 h-10 bg-slate-900 text-white rounded-full flex items-center justify-center font-bold">A</div>
               <div className="text-left">
                  <div className="font-bold text-slate-800 group-hover:text-blue-600">Adminisztrátor</div>
                  <div className="text-xs text-slate-500">Teljes hozzáférés, monitoring</div>
               </div>
            </button>
            <button onClick={() => handleLogin(UserRole.SUPERVISOR)} className="w-full p-4 border border-slate-200 rounded-xl flex items-center gap-4 hover:bg-slate-50 hover:border-blue-500 transition-all group">
               <div className="w-10 h-10 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold">T</div>
               <div className="text-left">
                  <div className="font-bold text-slate-800 group-hover:text-blue-600">Témavezető</div>
                  <div className="text-xs text-slate-500">Hallgatók menedzselése, Projektek</div>
               </div>
            </button>
            <button onClick={() => handleLogin(UserRole.STUDENT)} className="w-full p-4 border border-slate-200 rounded-xl flex items-center gap-4 hover:bg-slate-50 hover:border-blue-500 transition-all group">
               <div className="w-10 h-10 bg-green-500 text-white rounded-full flex items-center justify-center font-bold">H</div>
               <div className="text-left">
                  <div className="font-bold text-slate-800 group-hover:text-blue-600">Hallgató</div>
                  <div className="text-xs text-slate-500">Saját előrehaladás, Dokumentumok</div>
               </div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const renderContent = () => {
    switch (currentView) {
      case 'DASHBOARD':
        // Student shouldn't really see dashboard, but if they land here, redirect or show minimal
        return <Dashboard students={getVisibleStudents()} />;
      case 'STUDENT_LIST':
        return (
          <StudentList 
            students={getVisibleStudents()} 
            onSelectStudent={handleSelectStudent} 
            onAddStudent={() => setIsAddModalOpen(true)}
            userRole={currentUser.role}
          />
        );
      case 'STUDENT_DETAIL':
        const student = students.find(s => s.id === selectedStudentId);
        if (!student) return <div>Hallgató nem található</div>;
        return (
          <StudentDetail 
            student={student} 
            allStudents={students} // For peer finder
            currentUser={currentUser}
            onBack={() => currentUser.role === UserRole.STUDENT ? null : setCurrentView('STUDENT_LIST')} 
            onUpdateStudent={handleUpdateStudent}
          />
        );
      case 'SUPERVISOR_LIST':
        return <SupervisorList />;
      case 'PROJECTS':
        return (
           <ProjectBoard 
             projects={projects} 
             currentUser={currentUser} 
             onAddProject={handleAddProject} 
           />
        );
      default:
        return <Dashboard students={getVisibleStudents()} />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex font-sans text-slate-900">
      <Sidebar 
        currentView={currentView} 
        onChangeView={setCurrentView} 
        currentUser={currentUser}
        onLogout={handleLogout}
      />
      
      <main className="flex-1 ml-64 p-8 overflow-y-auto">
        <header className="mb-8 flex justify-between items-center">
          <div className="flex items-center gap-2 text-sm text-slate-500">
             <span>PhD Manager</span>
             <span>/</span>
             <span className="font-medium text-slate-800">
                {currentView === 'DASHBOARD' && 'Vezérlőpult'}
                {currentView === 'STUDENT_LIST' && 'Hallgatók'}
                {currentView === 'STUDENT_DETAIL' && 'Részletek'}
                {currentView === 'SUPERVISOR_LIST' && 'Témavezetők'}
                {currentView === 'PROJECTS' && 'Kutatási Projektek'}
             </span>
          </div>
          <div className="flex items-center gap-4">
             <div className="text-right hidden sm:block">
                <p className="text-sm font-bold text-slate-800">{currentUser.name}</p>
                <p className="text-xs text-slate-500">
                  {currentUser.role === UserRole.ADMIN ? 'Dékáni Hivatal' : 
                   currentUser.role === UserRole.SUPERVISOR ? 'Témavezető' : 'PhD Hallgató'}
                </p>
             </div>
             <div className="w-10 h-10 bg-slate-200 rounded-full overflow-hidden border border-slate-300">
                <img src={currentUser.avatarUrl} alt={currentUser.name} />
             </div>
          </div>
        </header>

        {renderContent()}
      </main>

      {isAddModalOpen && (
        <AddStudentModal 
          currentUser={currentUser}
          onClose={() => setIsAddModalOpen(false)} 
          onSave={handleAddStudent} 
        />
      )}
    </div>
  );
}

export default App;
