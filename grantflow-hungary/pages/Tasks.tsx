import React, { useState } from 'react';
import { Grant, Task } from '../types';
import { CheckCircle, Circle, Clock, FileText, Calendar, Folder, Layers } from 'lucide-react';

interface TasksProps {
  grants: Grant[];
  onUpdateGrant: (grant: Grant) => void;
}

const Tasks: React.FC<TasksProps> = ({ grants, onUpdateGrant }) => {
  const [groupBy, setGroupBy] = useState<'stage' | 'grant'>('stage');

  type TaskWithGrant = Task & { grantId: string; grantTitle: string };
  
  const allTasks: TaskWithGrant[] = grants.flatMap(grant => 
    (grant.tasks || []).map(task => ({
      ...task,
      grantId: grant.id,
      grantTitle: grant.title
    }))
  );

  const toggleTaskCompletion = (grantId: string, taskId: string) => {
    const grant = grants.find(g => g.id === grantId);
    if (!grant || !grant.tasks) return;
    
    const updatedTasks = grant.tasks.map(t => 
      t.id === taskId ? { ...t, completed: !t.completed } : t
    );
    
    onUpdateGrant({ ...grant, tasks: updatedTasks });
  };

  // Group by stage
  const stages = ['PRE-AWARD', 'SUBMISSION', 'POST-AWARD'];
  
  const tasksByStage = stages.reduce((acc, stage) => {
    acc[stage] = allTasks.filter(t => t.stage === stage);
    return acc;
  }, {} as Record<string, TaskWithGrant[]>);

  // Group by grant
  const tasksByGrant = grants.reduce((acc, grant) => {
    const grantTasks = allTasks.filter(t => t.grantId === grant.id);
    if (grantTasks.length > 0) {
      acc[grant.title] = grantTasks;
    }
    return acc;
  }, {} as Record<string, TaskWithGrant[]>);

  const renderTaskGroup = (title: string, icon: React.ReactNode, tasks: TaskWithGrant[]) => {
    if (tasks.length === 0) return null;

    return (
      <div key={title} className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="bg-slate-50 px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-bold text-slate-800 flex items-center gap-2">
            {icon}
            {title}
          </h3>
          <span className="text-xs font-medium bg-slate-200 text-slate-600 px-2 py-1 rounded-full">
            {tasks.length} tasks
          </span>
        </div>
        
        <div className="divide-y divide-slate-100">
          {tasks.map(task => (
            <div key={task.id} className={`p-6 flex items-start gap-4 transition-colors hover:bg-slate-50 ${task.completed ? 'opacity-60' : ''}`}>
              <button 
                onClick={() => toggleTaskCompletion(task.grantId, task.id)}
                className="mt-1 flex-shrink-0 text-slate-400 hover:text-accent transition-colors"
              >
                {task.completed ? (
                  <CheckCircle className="w-6 h-6 text-emerald-500" />
                ) : (
                  <Circle className="w-6 h-6" />
                )}
              </button>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h4 className={`text-base font-medium ${task.completed ? 'text-slate-500 line-through' : 'text-slate-900'}`}>
                      {task.title}
                    </h4>
                    <p className="text-sm text-slate-500 mt-1 line-clamp-2">
                      {task.description}
                    </p>
                  </div>
                  {task.dueDate && (
                    <div className="flex items-center gap-1 text-xs font-medium text-slate-500 bg-slate-100 px-2 py-1 rounded-md whitespace-nowrap">
                      <Calendar className="w-3 h-3" />
                      {new Date(task.dueDate).toLocaleDateString()}
                    </div>
                  )}
                </div>
                
                <div className="mt-3 flex items-center gap-3">
                  {groupBy === 'stage' && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-accent bg-blue-50 px-2 py-1 rounded-md">
                      <FileText className="w-3 h-3" />
                      {task.grantTitle}
                    </span>
                  )}
                  {groupBy === 'grant' && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 bg-amber-50 px-2 py-1 rounded-md">
                      <Layers className="w-3 h-3" />
                      {task.stage.replace('-', ' ')}
                    </span>
                  )}
                  {task.assignee && (
                    <span className="text-xs text-slate-500">
                      Assigned to: <span className="font-medium text-slate-700">{task.assignee}</span>
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="mb-8 flex items-end justify-between">
        <div>
          <h2 className="text-2xl font-bold text-primary">Tasks & Todo</h2>
          <p className="text-slate-500 mt-1">Manage all your pending tasks across your active grant applications.</p>
        </div>
        
        <div className="flex items-center bg-slate-100 p-1 rounded-lg">
          <button
            onClick={() => setGroupBy('stage')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors flex items-center gap-2 ${
              groupBy === 'stage' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Layers className="w-4 h-4" />
            By Stage
          </button>
          <button
            onClick={() => setGroupBy('grant')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors flex items-center gap-2 ${
              groupBy === 'grant' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Folder className="w-4 h-4" />
            By Grant
          </button>
        </div>
      </header>

      <div className="space-y-8">
        {groupBy === 'stage' ? (
          stages.map(stage => {
            const icon = stage === 'PRE-AWARD' ? <FileText className="w-5 h-5 text-blue-500" /> :
                         stage === 'SUBMISSION' ? <Clock className="w-5 h-5 text-amber-500" /> :
                         <CheckCircle className="w-5 h-5 text-emerald-500" />;
            return renderTaskGroup(stage.replace('-', ' '), icon, tasksByStage[stage]);
          })
        ) : (
          Object.entries(tasksByGrant).map(([grantTitle, tasks]) => (
            renderTaskGroup(grantTitle, <Folder className="w-5 h-5 text-accent" />, tasks)
          ))
        )}
        
        {allTasks.length === 0 && (
          <div className="text-center py-12 bg-white rounded-xl border border-slate-100 border-dashed">
            <CheckCircle className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <h3 className="text-lg font-medium text-slate-900">No tasks found</h3>
            <p className="text-slate-500 mt-1">You don't have any tasks across your applications yet.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Tasks;
