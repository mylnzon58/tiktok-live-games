const fs = require("fs");
const path = require("path");

function createStorage(filename, defaultValue) {
    const filePath = path.join(__dirname, "..", filename);

    return {
        save: (data) => {
            try {
                fs.writeFileSync(filePath, JSON.stringify(data));
            } catch (err) {
                console.error(`Error al guardar ${filename}:`, err.message);
            }
        },
        load: () => {
            if (fs.existsSync(filePath)) {
                try {
                    return JSON.parse(fs.readFileSync(filePath));
                } catch (err) {
                    console.error(`Error al cargar ${filename}:`, err.message);
                    return defaultValue;
                }
            }
            return defaultValue;
        }
    };
}

module.exports = {
    createStorage
};
