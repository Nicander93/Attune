//! One-at-a-time background jobs that the user can cancel.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

pub const CANCELLED: &str = "已取消";

#[derive(Default)]
pub struct JobSlot(Mutex<Option<Arc<AtomicBool>>>);

pub struct RunningJob<'a> {
    slot: &'a JobSlot,
    pub cancel: Arc<AtomicBool>,
}

impl JobSlot {
    pub fn start(&self, busy_message: &str) -> Result<RunningJob<'_>, String> {
        let mut current = self.0.lock().map_err(|_| busy_message.to_string())?;
        if current.is_some() {
            return Err(busy_message.to_string());
        }
        let cancel = Arc::new(AtomicBool::new(false));
        *current = Some(cancel.clone());
        Ok(RunningJob { slot: self, cancel })
    }

    pub fn cancel(&self) {
        if let Ok(current) = self.0.lock() {
            if let Some(flag) = current.as_ref() {
                flag.store(true, Ordering::Relaxed);
            }
        }
    }
}

impl Drop for RunningJob<'_> {
    fn drop(&mut self) {
        if let Ok(mut current) = self.slot.0.lock() {
            *current = None;
        }
    }
}

pub fn is_cancelled(flag: &AtomicBool) -> bool {
    flag.load(Ordering::Relaxed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_one_job_at_a_time_and_frees_the_slot_on_drop() {
        let slot = JobSlot::default();
        let job = slot.start("busy").unwrap();
        assert_eq!(slot.start("busy").err().as_deref(), Some("busy"));
        slot.cancel();
        assert!(is_cancelled(&job.cancel));
        drop(job);
        assert!(!is_cancelled(&slot.start("busy").unwrap().cancel));
    }
}
