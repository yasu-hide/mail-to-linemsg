(async () => {
    const availableRecipient = await fetch("/api/recipient").then(apiAvailableRecipient => apiAvailableRecipient.json()).then(apiAvailableRecipientJSON => apiAvailableRecipientJSON.result);

    const appendCol = ((...elem) => {
        const colDiv = document.createElement('div');
        colDiv.style = 'margin-top: 5px; margin-bottom: 1px;'
        colDiv.className = 'col-md-4';
        elem.forEach((el) => colDiv.appendChild(el));
        return colDiv;
    })

    const formInputEmail = ((value='', readOnly=false) => {
        const elem = document.createElement('input');
        elem.type = 'text';
        elem.name = 'formInputEmail';
        elem.className = 'form-control';
        elem.value = value;
        elem.maxLength = 30;
        elem.readOnly = readOnly;
        return elem;
    });

    const formInputRecipient = ((value='', readOnly=false) => {
        const elem = document.createElement('select');
        elem.name = 'formInputRecipient';
        elem.className = 'form-control';
        elem.disabled = readOnly;
        Array.from(new Map(availableRecipient.map(rcpt => [rcpt.ext_recipient_id, rcpt])).values())
            .map(rcpt => (({ ext_recipient_id, recipient_description }) => ({ ext_recipient_id, recipient_description }))(rcpt)).forEach(rcpt => {
            const recipientOption = document.createElement('option');
            recipientOption.value = rcpt.ext_recipient_id;
            recipientOption.text = rcpt.recipient_description;
            recipientOption.selected = (rcpt.ext_recipient_id === value);
            elem.add(recipientOption);
        });
        return elem;
    });

    const formButtonDel = ((extAddrId) => {
        const elem = document.createElement('button');
        elem.type = "button";
        elem.className = "btn btn-danger mx-md-1 my-md-1";
        elem.textContent = "Del";
        elem.addEventListener('click', async () => {
            const rootDOM = document.getElementById("container-root");
            console.log('Del ' + extAddrId);
            const res = await fetch(`/api/addr/${extAddrId}`, {
                method: 'DELETE',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            });
            if(res.status == 200)
                rootDOM.removeChild(document.getElementById(`rowDiv-${extAddrId}`));
        });
        return elem;
    });

    const formButtonAdd = (() => {
        const elem = document.createElement('button');
        elem.type = "button";
        elem.className = "btn btn-primary mx-md-1 my-md-1";
        elem.textContent = "Add";
        elem.addEventListener('click', async () => {
            console.log('Add');
            const rootDOM = document.getElementById("container-root");
            const formInputEmailNew = document.getElementById('formInputEmailNew').value;
            if(!formInputEmailNew) {
                console.log('e-mail address is empty.');
                return;
            }

            const formInputRecipientNew = document.getElementById('formInputRecipientNew').value;
            if(! availableRecipient.find(rcpt => rcpt.ext_recipient_id === formInputRecipientNew)) {
                console.log('available recipient not found.');
                return;
            }

            const res = await fetch("/api/addr", {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    formInputEmail: formInputEmailNew,
                    formInputRecipient: formInputRecipientNew
                })
            });
            if(res.status === 200) {
                const addrOne = await res.json().then(apiAddrJSON => apiAddrJSON.result);
                const rowDiv = document.createElement('div');
                rowDiv.className = 'row';
                rowDiv.id = `rowDiv-${addrOne.ext_addr_id}`
                rowDiv.appendChild(appendCol(formInputEmail(addrOne.addr_mail, true)));
                rowDiv.appendChild(appendCol(formInputRecipient(formInputRecipientNew, true)));
                rowDiv.appendChild(appendCol(formButtonDel(addrOne.ext_addr_id, true)));
                rootDOM.appendChild(rowDiv);
                document.getElementById('formInputEmailNew').value = '';
            } else {
                const eMsg = await res.json().then(apiAddrJSON => apiAddrJSON.msg);
                console.error(eMsg)
            }
        });
        return elem;
    });

    await Promise.all(availableRecipient.map(async rcpt => {
        if(!rcpt.ext_addr_id || !rcpt.addr_mail) {
            console.log('address not registered.');
            return Promise.resolve();
        }
        const rootDOM = document.getElementById("container-root");
        const rowDiv = document.createElement('div');
        rowDiv.className = 'row';
        rowDiv.id = `rowDiv-${rcpt.ext_addr_id}`;
        rowDiv.appendChild(appendCol(formInputEmail(rcpt.addr_mail, true)));
        rowDiv.appendChild(appendCol(formInputRecipient(rcpt.ext_recipient_id, true)));
        rowDiv.appendChild(appendCol(formButtonDel(rcpt.ext_addr_id)));
        rootDOM.appendChild(rowDiv);
    })).then(() => {
        const rootDOM = document.getElementById("container-new");
        const rowDiv = document.createElement('div');
        rowDiv.className = 'row';
        rowDiv.id = 'rowDiv-new';
        const formLabel = document.createElement('label');
        formLabel.htmlFor = 'formInputEmail';
        formLabel.className = 'sr-only';
        formLabel.textContent = 'Email';
        const formInputEmailNew = formInputEmail('');
        formInputEmailNew.id = 'formInputEmailNew';
        formInputEmailNew.pattern = '^[A-Za-z0-9][A-Za-z0-9\\-_.\\+]*';
        formInputEmailNew.placeholder = 'Enter email';
        formInputEmailNew.autofocus = true;
        formInputEmailNew.required = true;
        const formInputRecipientNew = formInputRecipient('');
        formInputRecipientNew.id = 'formInputRecipientNew';

        rowDiv.appendChild(appendCol(formLabel, formInputEmailNew));
        rowDiv.appendChild(appendCol(formInputRecipientNew));
        rowDiv.appendChild(appendCol(formButtonAdd()));
        rootDOM.appendChild(rowDiv);
    });
})();