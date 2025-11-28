# Sync Rails Tutor Tutorials

Sync tutorials from the rails-tutor skill to a companion GitHub repository for version control and mobile reading.

## Instructions

1. **Check for companion repo**: Look for `rails-tutor-tutorials` directory in the parent folder (e.g., if current repo is at `/path/to/my-app`, check for `/path/to/rails-tutor-tutorials`)

2. **If companion repo doesn't exist**:
   - Create the directory
   - Initialize git repo
   - Create a README.md explaining this is a personal Rails learning journey
   - Copy all `.md` files from `.claude/rails-tutor/tutorials/`
   - Create initial commit
   - Run `gh repo create rails-tutor-tutorials --private --source=. --push` to create GitHub repo and push

3. **If companion repo exists**:
   - Copy all `.md` files from `.claude/rails-tutor/tutorials/` to the companion repo (this will overwrite existing files with same names, which is what we want for updates)
   - Check `git status` in the companion repo
   - If there are changes (new files or modifications):
     - Stage all changes
     - Create a commit with message summarizing what was added/updated (e.g., "Add new tutorial on X" or "Update quiz scores for Y")
     - Push to origin

4. **Report results**: Tell the user what was synced (new tutorials added, existing tutorials updated, or "already in sync")

## Notes

- The tutorials source is: `.claude/rails-tutor/tutorials/`
- The companion repo should be at: `../rails-tutor-tutorials` (relative to current repo root)
- Always use `--private` when creating the GitHub repo
- Include learner_profile.md in the sync if it exists
